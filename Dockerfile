FROM node:20-slim
RUN npm install -g polymarket-toolkit-mcp@0.7.2
ENTRYPOINT ["polymarket-toolkit-mcp"]
