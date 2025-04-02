build:
	yarn build

models:
	yarn models build
rpc:
	yarn rpc build

common: models rpc

indexer: common
	yarn indexer build

file-retriever: common
	yarn file-retriever build

