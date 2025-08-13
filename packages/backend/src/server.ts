import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import fs from 'fs';
import path from 'path';

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Read secret key from file
let SECRET_KEY = '';
try {
  // Use import.meta.url to get the directory in ES modules
  const currentDir = path.dirname(new URL(import.meta.url).pathname);
  const secretKeyPath = path.join(currentDir, '../secret.key');
  SECRET_KEY = fs.readFileSync(secretKeyPath, 'utf8').trim();
  console.log('Secret key loaded successfully');
} catch (error) {
  console.error('Failed to read secret key file:', error);
  process.exit(1);
}

// Store connected clients
const clients = new Map<string, { id: string; socketId: string }>();

// Store invite link mappings (masterId -> inviteeId[])
const inviteLinks = new Map<string, string[]>();

app.use(express.static('public'));

io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);
  
  // Handle client registration with their provided ID
  socket.on('register-client', (clientId: string, secretKey?: string) => {
    // Check if this is a master client (not joining via invite link)
    const isMasterClient = !Array.from(inviteLinks.entries()).some(([_, invitees]) => 
      invitees.includes(clientId)
    );
    
    // If this is a master client, require secret key authentication
    if (isMasterClient && secretKey !== SECRET_KEY) {
      // Send 401 error to client
      socket.emit('auth-error', { message: 'Unauthorized: Invalid or missing secret key' });
      socket.disconnect();
      return;
    }
    
    // Store client info
    clients.set(clientId, { id: clientId, socketId: socket.id });
    
    // Broadcast updated client list to all clients with security filtering
    broadcastClientList();
  });
  
  // Handle invite link join requests
  socket.on('invite-link-join', (data: { masterId: string; inviteeId: string }) => {
    const { masterId, inviteeId } = data;
    
    // Check if master client exists
    if (!clients.has(masterId)) {
      socket.emit('invite-link-error', { message: 'Master client not found' });
      return;
    }
    
    // Store the invite link mapping
    if (!inviteLinks.has(masterId)) {
      inviteLinks.set(masterId, []);
    }
    inviteLinks.get(masterId)!.push(inviteeId);
    
    // Store client info for invitee
    clients.set(inviteeId, { id: inviteeId, socketId: socket.id });
    
    // Notify invitee of successful join
    socket.emit('invite-link-success', { masterId });
    
    // Notify master about new invitee
    const masterClient = clients.get(masterId);
    if (masterClient) {
      io.to(masterClient.socketId).emit('new-invitee', { inviteeId });
    }
    
    // Also notify the invitee about the master
    socket.emit('master-connected', { masterId });
    
    // Broadcast updated client list to all clients with security filtering
    broadcastClientList();
  });
  
  // Handle signaling for WebRTC with access control
  socket.on('offer', (data) => {
    // Check if sender is authorized to communicate with target
    const senderId = Array.from(clients.entries()).find(([_, client]) => client.socketId === socket.id)?.[0];
    if (!senderId || !isAuthorizedConnection(senderId, data.targetId)) {
      console.log(`Unauthorized connection attempt from ${senderId} to ${data.targetId}`);
      return;
    }
    
    const targetClient = Array.from(clients.values()).find(client => client.id === data.targetId);
    if (targetClient) {
      io.to(targetClient.socketId).emit('offer', data);
    }
  });
  
  socket.on('answer', (data) => {
    // Check if sender is authorized to communicate with target
    const senderId = Array.from(clients.entries()).find(([_, client]) => client.socketId === socket.id)?.[0];
    if (!senderId || !isAuthorizedConnection(senderId, data.targetId)) {
      console.log(`Unauthorized connection attempt from ${senderId} to ${data.targetId}`);
      return;
    }
    
    const targetClient = Array.from(clients.values()).find(client => client.id === data.targetId);
    if (targetClient) {
      io.to(targetClient.socketId).emit('answer', data);
    }
  });
  
  socket.on('ice-candidate', (data) => {
    // Check if sender is authorized to communicate with target
    const senderId = Array.from(clients.entries()).find(([_, client]) => client.socketId === socket.id)?.[0];
    if (!senderId || !isAuthorizedConnection(senderId, data.targetId)) {
      console.log(`Unauthorized connection attempt from ${senderId} to ${data.targetId}`);
      return;
    }
    
    const targetClient = Array.from(clients.values()).find(client => client.id === data.targetId);
    if (targetClient) {
      io.to(targetClient.socketId).emit('ice-candidate', data);
    }
  });
  
  // Handle message sending with access control
  socket.on('message', (data) => {
    // Check if sender is authorized to communicate with target
    const senderId = Array.from(clients.entries()).find(([_, client]) => client.socketId === socket.id)?.[0];
    if (!senderId || !isAuthorizedConnection(senderId, data.targetId)) {
      console.log(`Unauthorized message attempt from ${senderId} to ${data.targetId}`);
      return;
    }
    
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
      
      // Clean up invite link mappings
      // Remove invitee from master's list
      inviteLinks.forEach((invitees, masterId) => {
        const index = invitees.indexOf(clientIdToRemove);
        if (index !== -1) {
          invitees.splice(index, 1);
        }
      });
      
      // Remove master's entry if no invitees left
      const masterEntry = Array.from(inviteLinks.entries()).find(([masterId, _]) => masterId === clientIdToRemove);
      if (masterEntry) {
        inviteLinks.delete(masterEntry[0]);
      }
      
      // Broadcast updated client list to all clients with security filtering
      broadcastClientList();
    }
  });
});

// Helper function to check if a connection is authorized
function isAuthorizedConnection(senderId: string, targetId: string): boolean {
  // Check if sender is a master (has invitees)
  if (inviteLinks.has(senderId)) {
    // Masters can only connect to their invitees or themselves
    const invitees = inviteLinks.get(senderId) || [];
    return senderId === targetId || invitees.includes(targetId);
  }
  
  // Check if sender is an invitee
  for (const [masterId, invitees] of inviteLinks.entries()) {
    if (invitees.includes(senderId)) {
      // Invitees can only connect to their specific master
      return masterId === targetId;
    }
  }
  
  // Regular clients can connect to anyone
  return true;
}

// Function to broadcast client list with security filtering
function broadcastClientList() {
  clients.forEach((client, clientId) => {
    // Check if this client joined via invite link
    const masterId = Array.from(inviteLinks.entries()).find(([masterId, invitees]) => 
      invitees.includes(clientId)
    )?.[0];
    
    if (masterId) {
      // This is an invitee, only show master and self
      const masterClient = clients.get(masterId);
      const inviteeClient = clients.get(clientId);
      if (masterClient && inviteeClient) {
        io.to(client.socketId).emit('clients-list', [masterClient, inviteeClient]);
      }
    } else if (inviteLinks.has(clientId)) {
      // This is a master, show self and all invitees
      const masterClient = clients.get(clientId);
      const invitees = inviteLinks.get(clientId) || [];
      const inviteeClients = invitees.map(id => clients.get(id)).filter(Boolean) as { id: string; socketId: string }[];
      
      if (masterClient) {
        io.to(client.socketId).emit('clients-list', [masterClient, ...inviteeClients]);
      }
    } else {
      // Regular client, show only other regular clients and masters (not invitees of other masters)
      const regularClients = Array.from(clients.entries())
        .filter(([id, _]) => {
          // Don't show invitees of other masters
          for (const [masterId, invitees] of inviteLinks.entries()) {
            if (invitees.includes(id) && masterId !== clientId) {
              return false;
            }
          }
          return true;
        })
        .map(([_, client]) => client);
      
      io.to(client.socketId).emit('clients-list', regularClients);
    }
  });
}

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
