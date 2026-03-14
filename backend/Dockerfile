FROM node:18-alpine

# Set working directory
WORKDIR /usr/src/app

# Copy package and lock files
COPY package*.json ./

# Install dependencies (only production)
RUN npm ci --only=production

# Copy application source
COPY . .

# Expose standard port
EXPOSE 5000

# Start robust server
CMD [ "npm", "start" ]
