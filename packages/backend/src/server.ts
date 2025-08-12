import express from 'express';
import http from 'http';
import { Server } from 'socket.io';

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Store connected clients
const clients = new Map<string, { id: string; socketId: string }>();

app.use(express.static('public'));

io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);
  
  // Handle client registration with their provided ID
  socket.on('register-client', (clientId: string) => {
    // Store client info
    clients.set(clientId, { id: clientId, socketId: socket.id });
    
    // Broadcast updated client list to all clients
    io.emit('clients-list', Array.from(clients.values()));
  });
  
  // Handle signaling for WebRTC
  socket.on('offer', (data) => {
    const targetClient = Array.from(clients.values()).find(client => client.id === data.targetId);
    if (targetClient) {
      io.to(targetClient.socketId).emit('offer', data);
    }
  });
  
  socket.on('answer', (data) => {
    const targetClient = Array.from(clients.values()).find(client => client.id === data.targetId);
    if (targetClient) {
      io.to(targetClient.socketId).emit('answer', data);
    }
  });
  
  socket.on('ice-candidate', (data) => {
    const targetClient = Array.from(clients.values()).find(client => client.id === data.targetId);
    if (targetClient) {
      io.to(targetClient.socketId).emit('ice-candidate', data);
    }
  });
  
  // Handle message sending
  socket.on('message', (data) => {
    const targetClient = Array.from(clients.values()).find(client => client.id === data.targetId);
    if (targetClient) {
      io.to(targetClient.socketId).emit('message', data);
    }
  });
  
  // Handle disconnection
  socket.on('disconnect', () => {
    console.log(`User disconnected: ${socket.id}`);
    
    // Remove client from the map
    const clientIdToRemove = Array.from(clients.entries()).find(([_, client]) => client.socketId === socket.id)?.[0];
    if (clientIdToRemove) {
      clients.delete(clientIdToRemove);
      
      // Broadcast updated client list to all clients
      io.emit('clients-list', Array.from(clients.values()));
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
