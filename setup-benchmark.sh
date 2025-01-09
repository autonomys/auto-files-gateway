#!/bin/bash

if [ "$#" -ne 3 ]; then
    echo "Usage: $0 <concurrentFetches> <outConnections> <pendingOutConnections>"
    exit 1
fi

if ! [[ "$1" =~ ^[0-9]+$ ]] || ! [[ "$2" =~ ^[0-9]+$ ]] || ! [[ "$3" =~ ^[0-9]+$ ]]; then
    echo "Error: All arguments must be valid numbers."
    exit 1
fi


concurrentFetches=$1
outConnections=$2
pendingOutConnections=$3

echo "Running benchmark with $concurrentFetches concurrent fetches, $outConnections out connections, and $pendingOutConnections pending out connections..."

export MAX_SIMULTANEOUS_FETCHES=$concurrentFetches
export OUT_CONNECTIONS=$outConnections
export PENDING_OUT_CONNECTIONS=$pendingOutConnections
export RUST_LOG=subspace_data_retrieval=trace,subspace_networking::utils::piece_provider=trace

COMPOSE='docker compose --env-file .env -f docker/file-retriever/docker-compose.yml -f docker/object-mapping-indexer/docker-compose.yml -f docker/dev/docker.compose.db.yml'

$COMPOSE down
$COMPOSE up --build -d
echo "Waiting for gateway to start..."
sleep 120