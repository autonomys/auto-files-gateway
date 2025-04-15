# Auto-Files Gateway

This service is used for retrieving already archived files from the Autonomy's Decentralized Storage Network (DSN). For retrieving files these should be formatted complying the format in [`@autonomys/auto-dag-data`](https://www.npmjs.com/package/@autonomys/auto-dag-data) and files should be already archived.

## FAQs

- **What means a file to be archived?:** When a file is uploaded to Autonomy’s network as a series of transactions, it is not immediately distributed as segmented pieces from which farmers generate storage proofs. There's some variable delay between the transaction submission and the file availability that depends on the network congestion among other factors.

## How it works?

When a user requests the download of a file, the file retriever asks the object mapping indexer the position of the CID in the DSN and uses the subspace gateway to download it. For big files if there are more objects to be retrieved this process is repeated until all the object are downloaded.

Meanwhile, the object mapping indexer is constantly listening to the Autonomy's network for keeping track of the position of uploaded objects in the DSN.

![File Download Diagram](https://github.com/autonomys/auto-files-gateway/blob/main/.github/diagrams/file-download.png)

