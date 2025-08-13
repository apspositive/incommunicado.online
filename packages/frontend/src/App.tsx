import { useState, useEffect, useRef } from 'react';
import io from 'socket.io-client';
import { generate as generateWords } from 'random-words';
import './App.css';
import ThemeToggle from './components/ThemeToggle';

interface Client {
  id: string;
  socketId: string;
}

interface Message {
  id: string;
  senderId: string;
  targetId: string;
  content: string;
  timestamp: Date;
}

function App() {
  const [clientId, setClientId] = useState<string>('');
  const [clients, setClients] = useState<Client[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState<string>('');
  const [selectedClient, setSelectedClient] = useState<string>('');
  const [isCallActive, setIsCallActive] = useState<boolean>(false);
  const [unreadMessages, setUnreadMessages] = useState<Record<string, number>>({});
  
  const socketRef = useRef<any>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  
  // Generate client ID on app start and handle invitation links
  useEffect(() => {
    // Check if there's an invitation parameter in the URL
    const urlParams = new URLSearchParams(window.location.search);
    const invitationId = urlParams.get('join');
    
    if (invitationId) {
      // Store master ID for invitee
      localStorage.setItem('masterId', invitationId);
    }
    
    // Generate a unique ID using three random English words
    const words = generateWords({ exactly: 3, join: '-' });
    setClientId(words);
  }, []);
  
  // Initialize socket connection
  useEffect(() => {
    if (!clientId) return;
    
    socketRef.current = io('http://localhost:3001');
    
    // Check if this is an invitee joining via invite link
    const masterId = localStorage.getItem('masterId');
    if (masterId) {
      // Emit invite-link-join event
      socketRef.current.emit('invite-link-join', { masterId, inviteeId: clientId });
      
      // Handle invite link success
      socketRef.current.on('invite-link-success', (data: { masterId: string }) => {
        console.log('Successfully joined via invite link');
        // Automatically select the master client
        setSelectedClient(data.masterId);
        // Clear the invite link from localStorage
        localStorage.removeItem('masterId');
      });
      
      // Handle new invitee notifications (for masters)
      socketRef.current.on('new-invitee', (data: { inviteeId: string }) => {
        console.log('New invitee joined:', data.inviteeId);
        // Automatically select the new invitee if it's not already selected
        if (clients.some(client => client.id === data.inviteeId) && !selectedClient) {
          setSelectedClient(data.inviteeId);
        }
      });
      
      // Handle master connection notifications (for invitees)
      socketRef.current.on('master-connected', (data: { masterId: string }) => {
        console.log('Master connected:', data.masterId);
        // Automatically select the master client
        setSelectedClient(data.masterId);
      });
      
      // Handle invite link error
      socketRef.current.on('invite-link-error', (data: { message: string }) => {
        console.error('Invite link error:', data.message);
        alert(`Invite link error: ${data.message}`);
        // Clear the invite link from localStorage
        localStorage.removeItem('masterId');
      });
      
      // Handle new invitee notifications (for masters)
      socketRef.current.on('new-invitee', (data: { inviteeId: string }) => {
        console.log('New invitee joined:', data.inviteeId);
      });
    } else {
      // Send our client ID to the server (regular client)
      socketRef.current.emit('register-client', clientId);
    }
    
    socketRef.current.on('clients-list', (clientsList: Client[]) => {
      // Filter clients based on invite link status
      const masterId = localStorage.getItem('masterId') || 
        (Array.from(clientsList).find(client => client.id !== clientId) ? 
         Array.from(clientsList).find(client => client.id !== clientId)!.id : null);
      
      if (masterId) {
        // If this is an invitee, only show the master client
        const masterClient = clientsList.find(client => client.id === masterId);
        setClients(masterClient ? [masterClient] : []);
      } else {
        // Regular clients see all other clients
        setClients(clientsList.filter(client => client.id !== clientId));
      }
    });
    
    socketRef.current.on('message', (message: Message) => {
      setMessages(prev => [...prev, message]);
      
      // Track unread messages for each client
      if (message.senderId !== clientId && message.senderId !== selectedClient) {
        setUnreadMessages(prev => ({
          ...prev,
          [message.senderId]: (prev[message.senderId] || 0) + 1
        }));
      }
    });
    
    // Handle when messages are marked as read by another client
    socketRef.current.on('messages-marked-as-read', (data: { readerId: string }) => {
      setUnreadMessages(prev => {
        const newUnread = { ...prev };
        if (newUnread[data.readerId]) {
          delete newUnread[data.readerId];
        }
        return newUnread;
      });
    });
    
    // WebRTC signaling
    socketRef.current.on('offer', async (data: any) => {
      if (!peerConnectionRef.current) {
        initializePeerConnection();
      }
      
      try {
        await peerConnectionRef.current!.setRemoteDescription(new RTCSessionDescription(data.offer));
        const answer = await peerConnectionRef.current!.createAnswer();
        await peerConnectionRef.current!.setLocalDescription(answer);
        
        socketRef.current.emit('answer', {
          targetId: data.senderId,
          answer: answer
        });
      } catch (error) {
        console.error('Error handling offer:', error);
      }
    });
    
    socketRef.current.on('answer', async (data: any) => {
      try {
        await peerConnectionRef.current!.setRemoteDescription(new RTCSessionDescription(data.answer));
      } catch (error) {
        console.error('Error handling answer:', error);
      }
    });
    
    socketRef.current.on('ice-candidate', async (data: any) => {
      try {
        await peerConnectionRef.current!.addIceCandidate(new RTCIceCandidate(data.candidate));
      } catch (error) {
        console.error('Error adding ICE candidate:', error);
      }
    });
    
    return () => {
      if (socketRef.current) {
        socketRef.current.disconnect();
      }
      if (peerConnectionRef.current) {
        peerConnectionRef.current.close();
      }
    };
  }, [clientId]);
  
  // Initialize WebRTC peer connection
  const initializePeerConnection = () => {
    const configuration = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
      ]
    };
    
    peerConnectionRef.current = new RTCPeerConnection(configuration);
    
    peerConnectionRef.current.onicecandidate = (event) => {
      if (event.candidate && selectedClient) {
        socketRef.current.emit('ice-candidate', {
          targetId: selectedClient,
          candidate: event.candidate
        });
      }
    };
    
    peerConnectionRef.current.ontrack = (event) => {
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = event.streams[0];
      }
    };
    
    // Get local media stream
    navigator.mediaDevices.getUserMedia({ video: true, audio: true })
      .then(stream => {
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
        }
        
        stream.getTracks().forEach(track => {
          peerConnectionRef.current!.addTrack(track, stream);
        });
      })
      .catch(error => {
        console.error('Error accessing media devices:', error);
      });
  };
  
  // Send a message to selected client
  const sendMessage = () => {
    if (newMessage.trim() && selectedClient && socketRef.current) {
      const message: Message = {
        id: Date.now().toString(),
        senderId: clientId,
        targetId: selectedClient,
        content: newMessage,
        timestamp: new Date()
      };
      
      socketRef.current.emit('message', message);
      setMessages(prev => [...prev, message]);
      setNewMessage('');
    }
  };
  
  // Start a voice/video call
  const startCall = async () => {
    if (!selectedClient) return;
    
    initializePeerConnection();
    setIsCallActive(true);
    
    try {
      const offer = await peerConnectionRef.current!.createOffer();
      await peerConnectionRef.current!.setLocalDescription(offer);
      
      socketRef.current.emit('offer', {
        targetId: selectedClient,
        offer: offer
      });
    } catch (error) {
      console.error('Error creating offer:', error);
    }
  };
  
  return (
    <div className="app">
      <header>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h1>Incommunicado Messaging App</h1>
          <ThemeToggle />
        </div>
        <div className="client-id-container">
          <div 
            className="client-id"
            onClick={() => {
              const link = `${window.location.origin}?join=${clientId}`;
              navigator.clipboard.writeText(link);
              alert('Invite link copied to clipboard!');
            }}
            style={{ cursor: 'pointer' }}
          >
            Your ID: <strong>{clientId}</strong>
          </div>
        </div>
      </header>
      
      <main>
        <div className="clients-section">
          <h2>Connected Clients</h2>
          {clients.length === 0 ? (
            <p>No other clients connected</p>
          ) : (
            <ul>
              {clients.map(client => (
                <li 
                  key={client.id}
                  className={selectedClient === client.id ? 'selected' : ''}
                  onClick={() => {
                    // Reset unread count when selecting a client
                    if (unreadMessages[client.id]) {
                      setUnreadMessages(prev => {
                        const newUnread = { ...prev };
                        delete newUnread[client.id];
                        return newUnread;
                      });
                      
                      // Notify the sender that their messages have been read
                      if (socketRef.current) {
                        socketRef.current.emit('mark-messages-as-read', {
                          senderId: client.id,
                          targetId: clientId
                        });
                      }
                    }
                    setSelectedClient(client.id);
                  }}
                >
                  {client.id}
                  {unreadMessages[client.id] > 0 && (
                    <span className="unread-count">{unreadMessages[client.id]}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
        
        {isCallActive ? (
          // Show call section when call is active
          <div className="call-section">
            <h2>Voice/Video Call</h2>
            <div className="video-container">
              <div className="video-wrapper">
                <video ref={localVideoRef} autoPlay muted playsInline />
                <div className="video-label">You</div>
              </div>
              <div className="video-wrapper">
                <video ref={remoteVideoRef} autoPlay playsInline />
                <div className="video-label">Remote</div>
              </div>
            </div>
            <div className="call-controls">
              <button 
                onClick={() => {
                  setIsCallActive(false);
                  if (peerConnectionRef.current) {
                    peerConnectionRef.current.close();
                    peerConnectionRef.current = null;
                  }
                  if (localVideoRef.current && localVideoRef.current.srcObject) {
                    (localVideoRef.current.srcObject as MediaStream).getTracks().forEach(track => track.stop());
                    localVideoRef.current.srcObject = null;
                  }
                  if (remoteVideoRef.current && remoteVideoRef.current.srcObject) {
                    (remoteVideoRef.current.srcObject as MediaStream).getTracks().forEach(track => track.stop());
                    remoteVideoRef.current.srcObject = null;
                  }
                }}
              >
                End Call
              </button>
            </div>
          </div>
        ) : (
          // Show messaging section when no call is active
          <>
            <div className="messaging-section">
              <h2>Messages</h2>
              <div className="messages-container">
                {messages
                  .filter(msg => 
                    (msg.senderId === clientId && msg.targetId === selectedClient) ||
                    (msg.senderId === selectedClient && msg.targetId === clientId)
                  )
                  .map(message => (
                    <div 
                      key={message.id} 
                      className={`message ${message.senderId === clientId ? 'sent' : 'received'}`}
                    >
                      <div className="message-content">{message.content}</div>
                      <div className="message-time">
                        {new Date(message.timestamp).toLocaleTimeString()}
                      </div>
                    </div>
                  ))
                }
              </div>
              
              <div className="message-input">
                <input
                  type="text"
                  value={newMessage}
                  onChange={(e) => setNewMessage(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && sendMessage()}
                  placeholder="Type a message..."
                  disabled={!selectedClient}
                />
                <button onClick={sendMessage} disabled={!selectedClient}>Send</button>
              </div>
            </div>
            
            <div className="call-section">  
              <h2>Voice/Video Call</h2>
              <div className="call-controls">
                <button onClick={startCall} disabled={!selectedClient} className='start-call-btn'>
                  Start Call
                </button>
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}

export default App
