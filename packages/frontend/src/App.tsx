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
  const [authError, setAuthError] = useState<string | null>(null);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [volume, setVolume] = useState<number>(100);
  
  const socketRef = useRef<any>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  
  // Fallback function for copying text to clipboard
  const fallbackCopyTextToClipboard = (text: string) => {
    try {
      const textArea = document.createElement('textarea');
      textArea.value = text;
      
      // Avoid scrolling to bottom
      textArea.style.top = '0';
      textArea.style.left = '0';
      textArea.style.position = 'fixed';
      textArea.style.opacity = '0';
      
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      
      const successful = document.execCommand('copy');
      document.body.removeChild(textArea);
      
      if (successful) {
        alert('Invite link copied to clipboard!');
      } else {
        alert('Failed to copy link. Please copy it manually: ' + text);
      }
    } catch (err) {
      console.error('Fallback copy failed: ', err);
      alert('Failed to copy link. Please copy it manually: ' + text);
    }
  };
  
  // Function to copy client ID to clipboard
  const copyClientIdToClipboard = () => {
    const link = `${window.location.origin}?join=${clientId}`;
    
    // Try to use Clipboard API first
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(link)
        .then(() => {
          alert('Invite link copied to clipboard!');
        })
        .catch(err => {
          console.error('Failed to copy link: ', err);
          // Fallback to manual copy
          fallbackCopyTextToClipboard(link);
        });
    } else {
      // Fallback for older browsers or insecure contexts
      fallbackCopyTextToClipboard(link);
    }
  };
  
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
    
    console.log('Initializing socket connection with client ID:', clientId);
    
    // Determine backend URL based on environment
    let socketUrl: string;
    
    // Get environment variable safely
    const backendUrl = (import.meta as any).env?.VITE_BACKEND_URL;
    
    if (backendUrl) {
      // Use environment variable if set
      socketUrl = backendUrl;
    } else if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
      // Development environment - connect to localhost:3001
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      socketUrl = `${protocol}//localhost:3001`;
    } else {
      // Production environment - connect to same domain/port with /socket.io path
      // Apache will proxy /socket.io requests to the backend server
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const host = window.location.host; // includes port if any
      socketUrl = `${protocol}//${host}/socket.io`;
    }
    
    console.log('Socket URL:', socketUrl);
    
    socketRef.current = io(socketUrl);
    
    // Check if socket connection is established
    socketRef.current.on('connect', () => {
      console.log('Socket connected with ID:', socketRef.current.id);
    });
    
    // Handle connection errors
    socketRef.current.on('connect_error', (error: any) => {
      console.error('Socket connection error:', error);
      console.error('Failed to connect to:', socketUrl);
      // Set an error state to show to the user
      setAuthError(`Failed to connect to server: ${error.message}`);
    });
    
    // Handle disconnections
    socketRef.current.on('disconnect', (reason: any) => {
      console.log('Socket disconnected:', reason);
    });
    
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
      // Send our client ID to the server (regular client) with secret key
      const urlParams = new URLSearchParams(window.location.search);
      const urlSecretKey = urlParams.get('start_id');
      const storedSecretKey = localStorage.getItem('secretKey');
      const secretKey = urlSecretKey || storedSecretKey;
      
      console.log('Registering client:', clientId);
      console.log('Secret key:', secretKey);
      
      socketRef.current.emit('register-client', clientId, secretKey);
      
      // Also store the secret key in localStorage for future use
      if (secretKey) {
        localStorage.setItem('secretKey', secretKey);
      }
    }
    
    // Handle authentication errors
    socketRef.current.on('auth-error', (data: { message: string }) => {
      console.error('Authentication error:', data.message);
      setAuthError(`Authentication failed: ${data.message}. Please contact the administrator or try accessing via an invite link.`);
    });
    
    // Handle client list updates
    socketRef.current.on('clients-list', (clientsList: Client[]) => {
      // Update clients list - filter out self
      setClients(clientsList.filter(client => client.id !== clientId));
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
    // Check if WebRTC is supported
    if (!navigator.mediaDevices) {
      const errorMsg = 'WebRTC is not supported in your browser or context. Please ensure you are using a modern browser over HTTPS.';
      console.error(errorMsg);
      alert(errorMsg);
      return;
    }
    
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
        const errorMsg = 'Failed to access camera/microphone. Please ensure you have granted permissions and are using a secure connection (HTTPS).';
        alert(errorMsg);
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
    
    // Check if peer connection was successfully created
    if (!peerConnectionRef.current) {
      console.error('Failed to initialize peer connection');
      setIsCallActive(false);
      return;
    }
    
    setIsCallActive(true);
    
    try {
      const offer = await peerConnectionRef.current.createOffer();
      await peerConnectionRef.current.setLocalDescription(offer);
      
      socketRef.current.emit('offer', {
        targetId: selectedClient,
        offer: offer
      });
    } catch (error) {
      console.error('Error creating offer:', error);
      const errorMsg = 'Failed to start call. Please ensure you are using a secure connection (HTTPS) and have granted camera/microphone permissions.';
      alert(errorMsg);
      setIsCallActive(false);
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
              
              // Try to use Clipboard API first
              if (navigator.clipboard && window.isSecureContext) {
                navigator.clipboard.writeText(link)
                  .then(() => {
                    alert('Invite link copied to clipboard!');
                  })
                  .catch(err => {
                    console.error('Failed to copy link: ', err);
                    // Fallback to manual copy
                    fallbackCopyTextToClipboard(link);
                  });
              } else {
                // Fallback for older browsers or insecure contexts
                fallbackCopyTextToClipboard(link);
              }
            }}
            style={{ cursor: 'pointer' }}
          >
            Your ID: <strong>{clientId}</strong>
          </div>
        </div>
      </header>
      
      <main>
        {authError ? (
          <div className="auth-error">
            <h2>Authentication Error</h2>
            <p>{authError}</p>
            <div className="auth-error-help">
              <h3>How to resolve this issue:</h3>
              <ul>
                <li>If you're trying to create a new session, you need to access the app with a special URL that includes the secret key</li>
                <li>If you're joining an existing session, you should use an invite link provided by the session creator</li>
                <li>Contact the site administrator if you believe you should have access</li>
              </ul>
              <button onClick={() => {
                // Clear auth error and try to reconnect
                setAuthError(null);
                if (socketRef.current) {
                  socketRef.current.disconnect();
                  // Reinitialize connection
                  setTimeout(() => {
                    window.location.reload();
                  }, 100);
                }
              }}>Try Again</button>
            </div>
          </div>
        ) : (
          <>
            <div className="client-id-section">
              <h2>Your Client ID: <span className="client-id" onClick={copyClientIdToClipboard}>{clientId}</span></h2>
              <p className="instructions">Share this ID with others to connect, or use an invite link if someone shared one with you.</p>
            </div>
            
            <div className="invite-section">
              <h2>Invite Others</h2>
              <p>Share this link to invite others to connect with you:</p>
              <div className="invite-link-container">
                <code className="invite-link">{window.location.href}?join={clientId}</code>
              </div>
            </div>
            
            <div className="clients-section">
              <h2>Connected Clients</h2>
              {clients.length === 0 ? (
                <p>No other clients connected. Share your ID or invite link to connect with others.</p>
              ) : (
                <div className="client-list">
                  {clients.map(client => (
                    <div 
                      key={client.id} 
                      className={`client-item ${selectedClient === client.id ? 'selected' : ''}`} 
                      onClick={() => {
                        setSelectedClient(client.id);
                        // Mark messages as read when client is selected
                        setUnreadMessages(prev => ({
                          ...prev,
                          [client.id]: 0
                        }));
                        // Notify sender that their messages have been read
                        socketRef.current.emit('mark-messages-as-read', { senderId: clientId, targetId: client.id });
                      }}
                    >
                      {client.id}
                      {unreadMessages[client.id] > 0 && (
                        <span className="unread-count">{unreadMessages[client.id]}</span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
            
            {isCallActive ? (
              // Show call section when call is active
              <div className="call-section">
                <h2>Voice/Video Call</h2>
                <div className="video-container">
                  <div className="video-wrapper">
                    <video className="remote-video" ref={remoteVideoRef} autoPlay playsInline />
                    <video className="local-video" ref={localVideoRef} autoPlay muted playsInline />
                  </div>
                </div>
                <div className="call-controls">
                  <button 
                    className="mute-btn"
                    onClick={() => {
                      setIsMuted(!isMuted);
                      if (localVideoRef.current && localVideoRef.current.srcObject) {
                        const audioTracks = (localVideoRef.current.srcObject as MediaStream).getAudioTracks();
                        audioTracks.forEach(track => {
                          track.enabled = !isMuted;
                        });
                      }
                    }}
                  >
                    {isMuted ? 'Unmute' : 'Mute'}
                  </button>
                  
                  <div className="volume-control">
                    <label>Volume: {volume}%</label>
                    <input 
                      type="range" 
                      min="0" 
                      max="100" 
                      value={volume}
                      onChange={(e) => {
                        const newVolume = parseInt(e.target.value);
                        setVolume(newVolume);
                        if (remoteVideoRef.current) {
                          remoteVideoRef.current.volume = newVolume / 100;
                        }
                      }}
                    />
                  </div>
                  
                  <button 
                    className="end-call-btn"
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
                      // Reset mute and volume when call ends
                      setIsMuted(false);
                      setVolume(100);
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
                  <div className="messages-header">
                    <h2>Messages</h2>
                    <div className="call-controls">
                      <button onClick={startCall} disabled={!selectedClient} className='start-call-btn'>
                        Start Call
                      </button>
                    </div>
                  </div>
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
              </>
            )}
          </>
        )}
      </main>
    </div>
  );
}

export default App
