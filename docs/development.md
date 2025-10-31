# How to launch files gateway?

As is detailed on [docs](https://github.com/autonomys/auto-files-gateway/), files gateway is a three component system and should be launched in this order:

## 1. Subspace Node

Not essential you can optionally connect a remote RPC though you will have to wait for your published IPLD nodes to be archived.

## 2. Database

Both DAG indexer and object mapping indexer needs a database for storing some data. There you can launch a postgres at: `psql://postgres:postgres@localhost:5432/postgres` by executing the command `docker compose -f docker/object-mapping-indexer/docker-compose.yml --profile development up -d db`

## 3. DAG indexer

This will store the IPLD nodes metadata on a database which enables features like partial file retrieval and speeds up retrieval by not retrieving `Inlink` nodes.

You will have to setup the following `.env` at the root of the repo

```bash
# subquery params
RPC_ENDPOINTS=wss://rpc-0.mainnet.autonomys.xyz/ws # or your local
CHAIN_ID=0x66455a580aabff303720aa83adbe6c44502922251c03ba73686d5245da9e21bd
START_BLOCK=0 # this might fail if node is not in archival mode

# database
DB_USER=postgres
DB_PASSWORD=postgres
DB_DATABASE=postgres
DB_HOST=127.0.0.1
DB_PORT=5432
```

And launch it with:

```bash
make dag-indexer
yarn dag-indexer start
```

## 4. Object Mapping Indexer

For setting up the object mapping indexer, you will need to provide the following config at `services/object-mapping-indexer/.env`

```bash
NODE_RPC_URL=wss://rpc-0.mainnet.autonomys.xyz/ws # or your local
DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres
```

And, for launch it:

```bash
make indexer
yarn indexer start
```

## 5. File Retriever

Finally, the last piece of the files gateway is the file retriever which has the following config at `services/file-retriever/.env`

```bash
SUBSPACE_GATEWAY_URLS=http://localhost:9955
OBJECT_MAPPING_INDEXER_URL=http://localhost:3000
VICTORIA_ACTIVE=false
VICTORIA_ENDPOINT=<victoria-endpoint>
VICTORIA_USERNAME=<victoria-username>
VICTORIA_PASSWORD=<victoria-password>
API_SECRET=random-secret # the apikey needed for file retrieval
CORS_ORIGIN=*
MAX_SIMULTANEOUS_FETCHES=10 # optional
CACHE_DIR=./.cache # optional
CACHE_MAX_SIZE=1024000000 # optional
CACHE_TTL=86400000 # optional

```

And, for launch it:

```bash
make file-retriever
yarn file-retriever start
```

And with that files gateway would be fully deployed locally
