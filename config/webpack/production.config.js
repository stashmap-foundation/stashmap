const path = require("path");
const HtmlWebpackPlugin = require("html-webpack-plugin");
const TerserPlugin = require("terser-webpack-plugin");
const webpack = require("webpack");
const { WebpackManifestPlugin } = require("webpack-manifest-plugin");
const MiniCssExtractPlugin = require("mini-css-extract-plugin");
const paths = require("../paths");

require("dotenv").config({ path: "./.env" });

const cssRegex = /\.css$/;
const cssModuleRegex = /\.module\.css$/;
const sassRegex = /\.(scss|sass)$/;

module.exports = {
  mode: "production",
  entry: "/src/index.tsx",
  devtool: false,
  output: {
    path: path.join(__dirname, "../../build"),
    filename: "static/js/[name].[contenthash:8].js",
    chunkFilename: "static/js/[name].[contenthash:8].chunk.js",
    publicPath: process.env.WEBPACK_PUBLIC_PATH || "/",
  },
  optimization: {
    minimize: true,
    minimizer: [
      new TerserPlugin({
        terserOptions: {
          compress: true,
          output: {
            ecma: 5,
            comments: false,
            ascii_only: true,
          },
        },
      }),
    ],
    usedExports: true,
    splitChunks: {
      chunks: "all",
    },
  },
  infrastructureLogging: {
    level: "none",
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
          MiniCssExtractPlugin.loader,
          // Translates CSS into CommonJS
          "css-loader",
          // Compiles Sass to CSS
          "sass-loader",
        ],
      },
      {
        test: /\.css$/i,
        use: [MiniCssExtractPlugin.loader, "css-loader"],
        sideEffects: true,
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
      baseHref: process.env.WEBPACK_PUBLIC_PATH || "/",
      favicon: "./public/favicon.ico",
      minify: {
        removeComments: true,
        collapseWhitespace: true,
        removeRedundantAttributes: true,
        useShortDoctype: true,
        removeEmptyAttributes: true,
        removeStyleLinkTypeAttributes: true,
        keepClosingSlash: true,
        minifyJS: true,
        minifyCSS: true,
        minifyURLs: true,
      },
    }),
    new webpack.DefinePlugin({
      "process.env": JSON.stringify({
        ...process.env,
      }),
    }),
    new MiniCssExtractPlugin(),
    new WebpackManifestPlugin(),
  ],
};
