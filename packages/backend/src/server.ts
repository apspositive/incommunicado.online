import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import nodemailer from 'nodemailer';
import cors from 'cors';

const app = express();
const server = http.createServer(app);

// Enable CORS for all routes
app.use(cors());

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Store connected clients with their IDs and socket IDs
const clients = new Map<string, { id: string; socketId: string }>();

// Store authenticated sessions
const authenticatedSessions = new Map<string, boolean>();

// Store invite link mappings (target client ID -> [invitee socket IDs])
const inviteLinks = new Map<string, string[]>();

// Store user registrations
const registrations = new Map<string, {
  email: string;
  password: string;
  confirmed: boolean;
  approved: boolean;
  confirmationCode: string;
  createdAt: Date;
}>();

// Store confirmed users
const users = new Map<string, {
  email: string;
  password: string;
  approved: boolean;
  createdAt: Date;
}>();

// TODO Remove hardcoded user
users.set('apspositive@gmail.com', {
  email: 'apspositive@gmail.com',
  password: 'Tillicomer007!',
  approved: true,
  createdAt: new Date()
});

app.use(express.json());
app.use(express.static('public'));

// Registration route
app.post('/api/register', (req, res) => {
  const { email, password } = req.body;
  
  // Validate input
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }
  
  // Check if user already exists
  if (users.has(email)) {
    return res.status(400).json({ error: 'User already exists' });
  }
  
  // Check if registration already exists
  if (registrations.has(email)) {
    return res.status(400).json({ error: 'Registration already pending' });
  }
  
  // Generate confirmation code
  const confirmationCode = Math.random().toString(36).substring(2, 10).toUpperCase();
  
  // Store registration
  registrations.set(email, {
    email,
    password,
    confirmed: false,
    approved: false,
    confirmationCode,
    createdAt: new Date()
  });
  
  // Send confirmation email (in a real app, you would use a real email service)
  console.log(`Confirmation code for ${email}: ${confirmationCode}`);
  
  // In a real implementation, you would send an actual email here
  // For now, we'll just log it to the console
  
  res.json({ message: 'Registration successful. Please check your email for confirmation.' });
});

// Confirmation route
app.post('/api/confirm', (req, res) => {
  const { email, confirmationCode } = req.body;
  
  // Validate input
  if (!email || !confirmationCode) {
    return res.status(400).json({ error: 'Email and confirmation code are required' });
  }
  
  // Check if registration exists
  const registration = registrations.get(email);
  if (!registration) {
    return res.status(400).json({ error: 'Registration not found' });
  }
  
  // Check if already confirmed
  if (registration.confirmed) {
    return res.status(400).json({ error: 'Registration already confirmed' });
  }
  
  // Check confirmation code
  if (registration.confirmationCode !== confirmationCode) {
    return res.status(400).json({ error: 'Invalid confirmation code' });
  }
  
  // Mark as confirmed
  registration.confirmed = true;
  registrations.set(email, registration);
  
  // Send notification to admin for approval
  console.log(`New registration confirmed for ${email}. Awaiting admin approval.`);
  
  res.json({ message: 'Registration confirmed. Awaiting admin approval.' });
});

// Login route
app.post('/api/login', (req, res) => {
  const { email, password } = req.body;
  
  // Validate input
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }
  
  // Check if user exists and is approved
  const user = users.get(email);
  if (!user) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  
  // Check password
  if (user.password !== password) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  
  // Check if approved
  if (!user.approved) {
    return res.status(401).json({ error: 'Account not approved yet' });
  }
  
  res.json({ message: 'Login successful' });
});

// Debug endpoint to view registrations (temporary)
app.get('/api/debug/registrations', (req, res) => {
  const regArray: any[] = [];
  registrations.forEach((reg, email) => {
    regArray.push({ email, confirmed: reg.confirmed, approved: reg.approved, confirmationCode: reg.confirmationCode });
  });
  res.json(regArray);
});

// Admin approval route (in a real app, this would be protected)
app.post('/api/approve', (req, res) => {
  const { email, adminPassword } = req.body;
  
  // Check admin credentials
  const adminEmail = 'apspositive@gmail.com';
  const adminPass = 'Tillicomer007!';
  
  if (adminPassword !== adminPass) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  // Check if registration exists
  const registration = registrations.get(email);
  if (!registration) {
    return res.status(400).json({ error: 'Registration not found' });
  }
  
  // Check if confirmed
  if (!registration.confirmed) {
    return res.status(400).json({ error: 'Registration not yet confirmed' });
  }
  
  // Check if already approved
  if (registration.approved) {
    return res.status(400).json({ error: 'Registration already approved' });
  }
  
  // Mark as approved
  registration.approved = true;
  
  // Move to users
  users.set(email, {
    email,
    password: registration.password,
    approved: true,
    createdAt: registration.createdAt
  });
  
  // Remove from registrations
  registrations.delete(email);
  
  res.json({ message: 'User approved successfully' });
});

// Middleware to check authentication
const checkAuth = (socketId: string, clientId: string): boolean => {
  // For testing purposes, we'll allow all connections
  // In a real implementation, we would verify the authentication properly
  return true;
};

io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);
  
  // Handle client registration with their provided ID
  socket.on('register-client', (clientId: string) => {
    console.log(`Registering client: ${clientId} with socket ID: ${socket.id}`);
    // Check authentication
    if (!checkAuth(socket.id, clientId)) {
      console.log(`Authentication failed for client: ${clientId}`);
      socket.emit('auth-required', { message: 'Authentication required' });
      return;
    }
    
    // Store client info
    clients.set(clientId, { id: clientId, socketId: socket.id });
    console.log(`Client registered: ${clientId}, total clients: ${clients.size}`);
    
    // Mark session as authenticated
    authenticatedSessions.set(socket.id, true);
    
    // Broadcast updated client list
    const clientsList = Array.from(clients.values());
    
    // Send full list to all clients initially
    io.emit('clients-list', clientsList);
    
    // Check if this client is the target of any invite links
    // and send them an updated list if they're now online
    clientsList.forEach(client => {
      if (inviteLinks.has(client.id)) {
        // This client is the target of invite links
        const invitees = inviteLinks.get(client.id);
        if (invitees) {
          // Get all invitee clients
          const inviteeClients = invitees.map(inviteeId => clients.get(inviteeId)).filter(Boolean) as { id: string; socketId: string }[];
          // Send this client plus all their invitees to the target
          io.to(client.socketId).emit('clients-list', [client, ...inviteeClients]);
        }
      }
    });
  });
  
  // Handle invite link connections
  socket.on('invite-link-join', (data: { inviteeId: string, targetId: string }) => {
    console.log(`Invite link join: ${data.inviteeId} joining ${data.targetId}`);
    
    // Check authentication
    if (!checkAuth(socket.id, data.inviteeId)) {
      console.log(`Authentication failed for invitee: ${data.inviteeId}`);
      socket.emit('auth-required', { message: 'Authentication required' });
      return;
    }
    
    // Store client info
    clients.set(data.inviteeId, { id: data.inviteeId, socketId: socket.id });
    console.log(`Invitee registered: ${data.inviteeId}, total clients: ${clients.size}`);
    
    // Mark session as authenticated
    authenticatedSessions.set(socket.id, true);
    
    // Store invite link mapping (targetId -> [inviteeIds])
    if (inviteLinks.has(data.targetId)) {
      // Add this invitee to the list
      const invitees = inviteLinks.get(data.targetId);
      if (invitees) {
        invitees.push(data.inviteeId);
        inviteLinks.set(data.targetId, invitees);
      }
    } else {
      // Create new entry for this target
      inviteLinks.set(data.targetId, [data.inviteeId]);
    }
    
    // Check if target client is online
    const targetClient = Array.from(clients.values()).find(client => client.id === data.targetId);
    if (targetClient) {
      // Send only the target client to the invitee
      io.to(socket.id).emit('clients-list', [targetClient]);
      
      // Notify the target client about the new invitee
      // Get all invitees for this target
      const invitees = inviteLinks.get(data.targetId) || [];
      const inviteeClients = invitees.map(inviteeId => clients.get(inviteeId)).filter(Boolean) as { id: string; socketId: string }[];
      io.to(targetClient.socketId).emit('clients-list', [targetClient, ...inviteeClients]);
    } else {
      // If target client is not online, notify the invitee to disconnect
      io.to(socket.id).emit('invite-target-offline');
    }
  });
  
  // Handle call invitation
  socket.on('call-invite', (data: { senderId: string, targetId: string }) => {
    console.log(`Received call-invite from ${data.senderId} to ${data.targetId}`);
    // Check authentication
    if (!checkAuth(socket.id, data.senderId)) {
      socket.emit('auth-required', { message: 'Authentication required' });
      return;
    }
    
    const targetClient = Array.from(clients.values()).find(client => client.id === data.targetId);
    console.log(`Target client for call:`, targetClient);
    if (targetClient) {
      console.log(`Sending call-invite to socket ID: ${targetClient.socketId}`);
      io.to(targetClient.socketId).emit('call-invite', {
        ...data,
        senderId: data.senderId
      });
    } else {
      console.log(`Target client not found for call invitation`);
    }
  });
  
  // Handle call acceptance
  socket.on('call-accept', (data) => {
    // Check authentication
    if (!checkAuth(socket.id, data.senderId)) {
      socket.emit('auth-required', { message: 'Authentication required' });
      return;
    }
    
    const targetClient = Array.from(clients.values()).find(client => client.id === data.targetId);
    if (targetClient) {
      io.to(targetClient.socketId).emit('call-accept', {
        ...data,
        senderId: data.senderId
      });
    }
  });
  
  // Handle call rejection
  socket.on('call-reject', (data) => {
    // Check authentication
    if (!checkAuth(socket.id, data.senderId)) {
      socket.emit('auth-required', { message: 'Authentication required' });
      return;
    }
    
    const targetClient = Array.from(clients.values()).find(client => client.id === data.targetId);
    if (targetClient) {
      io.to(targetClient.socketId).emit('call-reject', {
        ...data,
        senderId: data.senderId
      });
    }
  });
  
  // Handle end call
  socket.on('end-call', (data) => {
    console.log(`Received end-call from ${data.senderId}`);
    // Check authentication
    if (!checkAuth(socket.id, data.senderId)) {
      console.log(`Authentication failed for end-call from ${data.senderId}`);
      socket.emit('auth-required', { message: 'Authentication required' });
      return;
    }
    
    // Notify all connected clients about the call ending
    console.log(`Broadcasting call-ended to all clients`);
    io.emit('call-ended', {
      ...data,
      senderId: data.senderId
    });
  });
  
  // Handle signaling for WebRTC
  socket.on('offer', (data) => {
    // Check authentication
    if (!checkAuth(socket.id, data.senderId)) {
      socket.emit('auth-required', { message: 'Authentication required' });
      return;
    }
    
    const targetClient = Array.from(clients.values()).find(client => client.id === data.targetId);
    if (targetClient) {
      io.to(targetClient.socketId).emit('offer', data);
    }
  });
  
  socket.on('answer', (data) => {
    // Check authentication
    if (!checkAuth(socket.id, data.senderId)) {
      socket.emit('auth-required', { message: 'Authentication required' });
      return;
    }
    
    const targetClient = Array.from(clients.values()).find(client => client.id === data.targetId);
    if (targetClient) {
      io.to(targetClient.socketId).emit('answer', data);
    }
  });
  
  socket.on('ice-candidate', (data) => {
    // Find the client that sent this message
    const senderClient = Array.from(clients.values()).find(client => client.socketId === socket.id);
    if (!senderClient) {
      return;
    }
    
    // Check authentication
    if (!checkAuth(socket.id, senderClient.id)) {
      socket.emit('auth-required', { message: 'Authentication required' });
      return;
    }
    
    const targetClient = Array.from(clients.values()).find(client => client.id === data.targetClientId);
    if (targetClient) {
      io.to(targetClient.socketId).emit('ice-candidate', {
        ...data,
        senderId: senderClient.id
      });
    }
  });
  
  // Handle message sending
  socket.on('message', (data) => {
    // Check authentication
    if (!checkAuth(socket.id, data.senderId)) {
      socket.emit('auth-required', { message: 'Authentication required' });
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
      
      // Remove client from invite links mappings
      // Check if this client was a target of invite links
      if (inviteLinks.has(clientIdToRemove)) {
        // Remove the invite link entry
        inviteLinks.delete(clientIdToRemove);
      }
      
      // Check if this client was an invitee
      for (const [targetId, invitees] of inviteLinks.entries()) {
        const inviteeIndex = invitees.indexOf(clientIdToRemove);
        if (inviteeIndex !== -1) {
          invitees.splice(inviteeIndex, 1);
          // If no more invitees, remove the entry
          if (invitees.length === 0) {
            inviteLinks.delete(targetId);
          } else {
            inviteLinks.set(targetId, invitees);
          }
          break;
        }
      }
      
      // Broadcast updated client list to all clients
      io.emit('clients-list', Array.from(clients.values()));
    }
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
