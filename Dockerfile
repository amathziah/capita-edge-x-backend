FROM node:20-alpine
WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci --only=production

# Copy source code
COPY . .

# Expose Port
EXPOSE 3000

# Start command
CMD ["npm", "start"]
