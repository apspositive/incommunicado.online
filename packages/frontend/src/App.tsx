import { useState, useEffect, useRef } from 'react';
import io from 'socket.io-client';
import { generate as generateWords } from 'random-words';
import './App.css';
import { useAuth } from './auth/AuthContext';
import Login from './auth/Login';
import Registration from './auth/Registration';
import ThemeToggle from './theme/ThemeToggle';

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
  const { isAuthenticated, checkInviteLink } = useAuth();
  const [clientId, setClientId] = useState<string>('');
  const [clients, setClients] = useState<Client[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState<string>('');
  const [selectedClient, setSelectedClient] = useState<string>('');
  const [isCallActive, setIsCallActive] = useState<boolean>(false);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [showRegistration, setShowRegistration] = useState<boolean>(false);
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
      // If there's an invitation, show a notification to the user
      setTimeout(() => {
        alert(`You've been invited to join a conversation with ID: ${invitationId}`);
        // You could automatically select this client or show a special UI
      }, 1000);
      // For invited clients, use the invitation ID as the client ID
      setClientId(invitationId);
    } else {
      // Generate a unique ID using three random English words for regular users
      const words = generateWords({ exactly: 3, join: '-' });
      setClientId(words);
    }
  }, []);

  // Initialize socket connection only after authentication
  useEffect(() => {
    // Only establish WebSocket connection if authenticated or using valid invite link
    if (!clientId || (!isAuthenticated && !checkInviteLink())) return;
    
    socketRef.current = io('http://localhost:3001');
    
    // Send our client ID to the server
    socketRef.current.emit('register-client', clientId);
    
    socketRef.current.on('clients-list', (clientsList: Client[]) => {
      setClients(clientsList.filter(client => client.id !== clientId));
    });
    
    socketRef.current.on('message', (message: Message) => {
      setMessages(prev => [...prev, message]);
    });
    
    // WebRTC signaling
    // Handle incoming call invitation
    socketRef.current.on('call-invite', (data: any) => {
      const caller = clients.find(client => client.id === data.senderId);
      if (caller) {
        const accept = window.confirm(`Incoming call from ${caller.id}. Accept?`);
        if (accept) {
          startCall(false);
        } else {
          if (socketRef.current) {
            socketRef.current.emit('call-reject', { 
              senderId: clientId, 
              targetId: data.senderId 
            });
          }
        }
      }
    });
    
    // Handle authentication required
    socketRef.current.on('auth-required', (data: any) => {
      alert(data.message);
      // In a real app, you would redirect to login page
    });
    
    // Handle call acceptance
    socketRef.current.on('call-accept', async () => {
      alert('Call accepted!');
      // Start the WebRTC connection
      initializePeerConnection();
    });
    
    // Handle call rejection
    socketRef.current.on('call-reject', () => {
      alert('Call rejected.');
    });
    
    // Handle WebRTC offer
    if (socketRef.current) {
      socketRef.current.on('offer', async (data: any) => {
        if (!peerConnectionRef.current) {
          initializePeerConnection();
        }
        
        try {
          await peerConnectionRef.current!.setRemoteDescription(new RTCSessionDescription(data.offer));
          // Create and send answer
          const answer = await peerConnectionRef.current!.createAnswer();
          await peerConnectionRef.current!.setLocalDescription(answer);
          socketRef.current!.emit('answer', { targetClientId: selectedClient, answer });
        } catch (error) {
          console.error('Error handling offer:', error);
        }
      });
    }

    if (socketRef.current) {
      socketRef.current.on('answer', async (answer: RTCSessionDescriptionInit) => {
        if (peerConnectionRef.current) {
          await peerConnectionRef.current.setRemoteDescription(new RTCSessionDescription(answer));
        }
      });
    }

    if (socketRef.current) {
      socketRef.current.on('ice-candidate', async (candidate: RTCIceCandidate) => {
        if (peerConnectionRef.current) {
          await peerConnectionRef.current.addIceCandidate(new RTCIceCandidate(candidate));
        }
      });
    }

    if (socketRef.current) {
      socketRef.current.on('call-ended', () => {
        endCall();
      });
    }

    if (socketRef.current) {
      socketRef.current.on('auth-required', (data: { message: string }) => {
        console.log('Authentication required:', data.message);
      });
    }

    return () => {
      if (socketRef.current) {
        socketRef.current.disconnect();
      }
    };
  }, [clientId, isAuthenticated, checkInviteLink]);

  // Setup video streams
  useEffect(() => {
    if (localVideoRef.current && localStream) {
      localVideoRef.current.srcObject = localStream;
    }
    if (remoteVideoRef.current && remoteStream) {
      remoteVideoRef.current.srcObject = remoteStream;
    }
  }, [localStream, remoteStream]);

  const initializePeerConnection = () => {
    const configuration = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
    const peerConnection = new RTCPeerConnection(configuration);
    peerConnectionRef.current = peerConnection;

    if (localStream) {
      localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));
    }

    peerConnection.ontrack = (event) => {
      setRemoteStream(event.streams[0]);
    };

    peerConnection.onicecandidate = (event) => {
      if (event.candidate && socketRef.current) {
        socketRef.current.emit('ice-candidate', { 
          senderId: clientId, 
          targetId: selectedClient, 
          candidate: event.candidate 
        });
      }
    };

    return peerConnection;
  };

  const startCall = async (isCaller: boolean) => {
    if (!selectedClient || !socketRef.current) return;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      setLocalStream(stream);

      const configuration = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
      const peerConnection = new RTCPeerConnection(configuration);
      peerConnectionRef.current = peerConnection;

      stream.getTracks().forEach(track => peerConnection.addTrack(track, stream));

      peerConnection.ontrack = (event) => {
        setRemoteStream(event.streams[0]);
      };

      peerConnection.onicecandidate = (event) => {
        if (event.candidate && socketRef.current) {
          socketRef.current.emit('ice-candidate', { targetClientId: selectedClient, candidate: event.candidate });
        }
      };

      if (isCaller) {
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        socketRef.current.emit('offer', { targetClientId: selectedClient, offer });
      }

      setIsCallActive(true);
    } catch (error) {
      console.error('Error starting call:', error);
    }
  };

  const endCall = () => {
    if (localStream) {
      localStream.getTracks().forEach(track => track.stop());
      setLocalStream(null);
    }
    if (remoteStream) {
      remoteStream.getTracks().forEach(track => track.stop());
      setRemoteStream(null);
    }
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }
    if (socketRef.current && selectedClient) {
      socketRef.current.emit('end-call', { targetClientId: selectedClient });
    }
    setIsCallActive(false);
  };

  const sendMessage = () => {
    if (!newMessage.trim() || !selectedClient || !socketRef.current) return;

    const message: Message = {
      id: Date.now().toString(),
      content: newMessage,
      senderId: clientId,
      targetId: selectedClient,
      timestamp: new Date()
    };

    socketRef.current.emit('message', message);
    setMessages(prev => [...prev, message]);
    setNewMessage('');
  };

  if (!isAuthenticated && !checkInviteLink()) {
    return showRegistration ? (
      <Registration />
    ) : (
      <Login onRegisterClick={() => setShowRegistration(true)} />
    );
  }

  return (
    <div className="app">
      <header>
        <h1>Incommunicado Messaging App</h1>
        <div className="header-controls">
          {/* Only show client ID and invite link for non-invited clients */}
          {!checkInviteLink() && (
            <div className="client-id-container">
              <div className="client-id">
                Your ID: <strong>{clientId}</strong>
              </div>
              <button className="copy-link-btn" onClick={() => {
                const link = `${window.location.origin}?join=${clientId}`;
                navigator.clipboard.writeText(link);
                alert('Invite link copied to clipboard!');
              }}>
                Copy Invite Link
              </button>
            </div>
          )}
          <div className="theme-toggle-container">
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main>
        <section className="clients-section">
          <h2>Online Clients</h2>
          <ul>
            {clients.filter(client => client.id !== clientId).map(client => (
              <li 
                key={client.id}
                className={selectedClient === client.id ? 'selected' : ''}
                onClick={() => setSelectedClient(client.id)}
              >
                {client.id}
              </li>
            ))}
          </ul>
        </section>

        <section className="messaging-section">
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
            <button onClick={sendMessage} disabled={!selectedClient}>
              Send
            </button>
          </div>
        </section>

        <section className="call-section">
          <h2>Video Call</h2>
          <div className="video-container">
            <div className="video-wrapper">
              <video ref={localVideoRef} autoPlay muted />
              <div className="video-label">You</div>
            </div>
            <div className="video-wrapper">
              <video ref={remoteVideoRef} autoPlay />
              <div className="video-label">Remote</div>
            </div>
          </div>
          <div className="call-controls">
            {!isCallActive ? (
              <button 
                onClick={() => startCall(true)} 
                disabled={!selectedClient}
              >
                Start Call
              </button>
            ) : (
              <button onClick={endCall}>
                End Call
              </button>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}

export default App
