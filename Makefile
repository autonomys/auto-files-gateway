all: common models rpc indexer file-retriever

models:
	yarn models build
rpc:
	yarn rpc build

common: models rpc

indexer: common
	yarn indexer build

file-retriever: common
	yarn file-retriever build

lint:
	yarn lint

test:
	yarn test

