import path from 'path';
import React from 'react';
import ReactDOM from 'react-dom/server';
import { RouterContext, match } from 'react-router';
import PrettyError from 'pretty-error';
import createMemoryHistory from 'react-router/lib/createMemoryHistory';
import { Provider } from 'react-redux';

import createStore from '../shared/create';
import Html from '../containers/HtmlShell/HtmlShell';
import configure from '../configure';
import getTools from './tools';

global.__CLIENT__ = false;
global.__SERVER__ = true;
global.__DISABLE_SSR__ = false;  // <----- DISABLES SERVER SIDE RENDERING FOR ERROR DEBUGGING
global.__DEVELOPMENT__ = process.env.NODE_ENV !== 'production';

export default (projectConfig, projectToolsConfig) => {
  const tools = getTools(projectConfig, projectToolsConfig);
  const config = configure(projectConfig);
  const getRoutes = require(path.resolve(config.routes)).default;
  const reducers = require(path.resolve(config.redux.reducers)).default;
  const pretty = new PrettyError();

  let CustomHtml;
  if (config.htmlShell) {
    CustomHtml = require(path.resolve(config.htmlShell)).default;
  } else {
    CustomHtml = Html;
  }

  const dynamicMiddleware = (originalUrl, headers, send, redirect) => {
    if (__DEVELOPMENT__) {
      // Do not cache webpack stats: the script file would change since
      // hot module replacement is enabled in the development env
      tools.refresh();
    }

    const middleware = config.redux.middleware ? require(path.resolve(config.redux.middleware)).default : [];

    const history = createMemoryHistory();
    const store = createStore(middleware, history, reducers);

    function hydrateOnClient() {
      send(200, '<!doctype html>\n' + ReactDOM.renderToString(<CustomHtml assets={tools.assets()} store={store}
                                                                          headers={headers}/>));
    }

    if (__DISABLE_SSR__) {
      hydrateOnClient();
      return;
    }

    match({history, routes: getRoutes(store), location: originalUrl}, (error, redirectLocation, renderProps) => {
      if (redirectLocation) {
        redirect(redirectLocation.pathname + redirectLocation.search);
      } else if (error) {
        console.error('ROUTER ERROR:', pretty.render(error));
        send(500);
        hydrateOnClient();
      } else if (renderProps) {
        const component = (
          <Provider store={store} key="provider">
            <RouterContext {...renderProps} />
          </Provider>
        );
        send(200, '<!doctype html>\n' + ReactDOM.renderToString(<CustomHtml assets={tools.assets()} component={component} store={store} headers={headers}/>));
      } else {
        send(400, 'Not found');
      }
    });
  };

  switch (config.server.webFramework) {
    case 'koa':
    {
      return function *() {
        dynamicMiddleware(this.request.originalUrl,
          this.request.headers,
          (status, body) => {
            this.body = body;
            this.status = status
          },
          (url) => this.response.redirect(url))
      }
    }
    default:
    case 'express':
    {
      return (req, res) => {
        dynamicMiddleware(req.originalUrl,
          req._headers,
          (status, body) => res.status(status).send(body),
          (url) => res.redirect(url));
      }
    }
  }

};
