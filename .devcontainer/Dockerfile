FROM node:22-alpine

RUN apk add --no-cache shadow bash curl
RUN apk add --no-cache git fish openssh
RUN apk add --no-cache ripgrep

RUN chsh -s /usr/bin/fish node

WORKDIR /workspace

RUN chown node:node /workspace
RUN npm i -g gsd-opencode

USER node

RUN mkdir -p ~/.config/fish && touch ~/.config/fish/config.fish
RUN bash -o pipefail -c "curl -fsSL https://opencode.ai/install | bash"
