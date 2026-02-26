FROM node:22-alpine

RUN apk add --no-cache shadow bash
RUN apk add --no-cache git fish openssh

RUN chsh -s /usr/bin/fish node

WORKDIR /workspace

RUN chown node:node /workspace

USER node
