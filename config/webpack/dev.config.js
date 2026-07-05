const path = require("path");
const HtmlWebpackPlugin = require("html-webpack-plugin");
const webpack = require("webpack");
const paths = require("../paths");

require("dotenv").config({ path: "./.env" });

const cssRegex = /\.css$/;
const cssModuleRegex = /\.module\.css$/;
const sassRegex = /\.(scss|sass)$/;

module.exports = {
  mode: "development",
  entry: "/src/index.tsx",
  devtool: "inline-source-map",
  output: {
    path: path.join(__dirname, "/dist"),
    filename: "bundle.js",
    publicPath: "/",
  },
  devtool: "inline-source-map",
  infrastructureLogging: {
    level: "none",
  },
  stats: "summary",
  devServer: {
    //static: "./dist",
    port: 4000,
    compress: true,
    liveReload: true,
    client: {
      logging: "none",
    },
    static: path.appPublic,
    historyApiFallback: {
      disableDotRule: true,
    },
    // Dev twin of netlify/functions/ical-proxy.mjs: calendar feeds are
    // fetched server-side so the browser never hits CORS.
    setupMiddlewares: (middlewares, devServer) => {
      devServer.app.get(
        "/.netlify/functions/ical-proxy",
        async (request, response) => {
          const raw = request.query.url;
          if (!raw) {
            response.status(400).send("missing url parameter");
            return;
          }
          try {
            const target = new URL(
              String(raw).replace(/^webcal:\/\//u, "https://")
            );
            if (target.protocol !== "https:" && target.protocol !== "http:") {
              response.status(400).send("unsupported scheme");
              return;
            }
            const upstream = await fetch(target, {
              signal: AbortSignal.timeout(10000),
            });
            if (!upstream.ok) {
              response.status(502).send(`upstream status ${upstream.status}`);
              return;
            }
            response
              .set("content-type", "text/calendar; charset=utf-8")
              .send(await upstream.text());
          } catch (error) {
            response.status(502).send("upstream fetch failed");
          }
        }
      );
      return middlewares;
    },
  },
  module: {
    rules: [
      {
        test: /\.(js|mjs|jsx|ts|tsx)$/,
        exclude: /node_modules/,
        use: "swc-loader",
      },
      {
        test: /\.s[ac]ss$/i,
        use: [
          // Creates `style` nodes from JS strings
          "style-loader",
          // Translates CSS into CommonJS
          "css-loader",
          // Compiles Sass to CSS
          "sass-loader",
        ],
      },
      {
        test: /\.css$/i,
        use: ["style-loader", "css-loader"],
      },
      {
        test: /\.(jpe?g|png|gif|svg)(\?[a-z0-9=.]+)?$/,
        use: "url-loader",
      },
    ],
  },
  resolve: {
    extensions: [".jsx", ".ts", ".js", ".tsx"],
    fallback: {
      url: require.resolve("url/"),
      crypto: require.resolve("crypto-browserify"),
      assert: require.resolve("assert/"),
      stream: require.resolve("stream-browserify"),
      buffer: require.resolve("buffer"),
      "process/browser": require.resolve("process/browser"),
      vm: require.resolve("vm-browserify"),
    },
  },
  plugins: [
    // Work around for Buffer is undefined:
    // https://github.com/webpack/changelog-v5/issues/10
    new webpack.ProvidePlugin({
      Buffer: ["buffer", "Buffer"],
    }),
    new webpack.ProvidePlugin({
      process: "process/browser",
    }),
    new HtmlWebpackPlugin({
      title: "Dev",
      template: paths.appHtml,
      baseHref: "/",
    }),
    new webpack.DefinePlugin({
      "process.env": JSON.stringify({
        ...process.env,
      }),
    }),
  ],
};
