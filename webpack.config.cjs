const path = require('node:path');
const HtmlWebpackPlugin = require('html-webpack-plugin');

module.exports = (_, argv) => ({
	entry: './src/index.tsx',
	output: {
		path: path.resolve(__dirname, 'dist'),
		filename: 'assets/[name].[contenthash].js',
		clean: true,
		publicPath: '/'
	},
	resolve: {extensions: ['.tsx', '.ts', '.js']},
	module: {
		rules: [
			{test: /\.tsx?$/, use: {loader: 'esbuild-loader', options: {loader: 'tsx', target: 'es2022'}}, exclude: /node_modules/},
			{test: /\.s[ac]ss$/, use: ['style-loader', 'css-loader', 'sass-loader']}
		]
	},
	plugins: [new HtmlWebpackPlugin({template: './src/index.html', title: 'Power Usage | HosRocket'})],
	devtool: argv.mode === 'development' ? 'eval-source-map' : 'source-map',
	devServer: {
		port: 3000,
		static: {directory: path.resolve(__dirname, '.')},
		historyApiFallback: true,
		client: {overlay: false},
		open: true
	}
});