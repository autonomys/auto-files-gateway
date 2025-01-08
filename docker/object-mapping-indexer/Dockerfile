FROM node:20

WORKDIR /app

COPY . .

RUN apt-get update && apt-get install -y \
    build-essential \
    python3 \
    python3-pip \
    python3-setuptools \
    git \
    libsqlite3-dev
RUN npm install -g corepack
RUN corepack prepare yarn@4.2.2 --activate
RUN rm -rf node_modules
RUN yarn add tar
RUN yarn
RUN yarn indexer build

EXPOSE 3000

CMD ["yarn", "indexer", "start"]
