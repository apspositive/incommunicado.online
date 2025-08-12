import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';

interface AuthContextType {
  isAuthenticated: boolean;
  login: (username: string, password: string) => Promise<boolean>;
  logout: () => void;
  checkInviteLink: () => boolean;
  register: (email: string, password: string) => Promise<{ success: boolean; message: string }>;
  confirmRegistration: (email: string, confirmationCode: string) => Promise<{ success: boolean; message: string }>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

interface AuthProviderProps {
  children: ReactNode;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  // Check if user is accessing via valid invite link on app initialization
  useEffect(() => {
    const isValidInvite = checkInviteLink();
    if (isValidInvite) {
      setIsAuthenticated(true);
    }
  }, []);

  const login = async (email: string, password: string): Promise<boolean> => {
    try {
      const response = await fetch('http://localhost:3001/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      
      if (response.ok) {
        setIsAuthenticated(true);
        return true;
      }
      return false;
    } catch (error) {
      console.error('Login error:', error);
      return false;
    }
  };

  const register = async (email: string, password: string): Promise<{ success: boolean; message: string }> => {
    if (email && password) {
      try {
        const response = await fetch('http://localhost:3001/api/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password })
        });
        const data = await response.json();
        return { success: response.ok, message: data.message || 'Registration successful' };
      } catch (error) {
        return { success: false, message: 'Registration failed. Please try again.' };
      }
    }
    return { success: false, message: 'Email and password are required.' };
  };

  const confirmRegistration = async (email: string, confirmationCode: string): Promise<{ success: boolean; message: string }> => {
    if (email && confirmationCode) {
      try {
        const response = await fetch('http://localhost:3001/api/confirm', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, confirmationCode })
        });
        const data = await response.json();
        return { success: response.ok, message: data.message || 'Confirmation successful' };
      } catch (error) {
        return { success: false, message: 'Confirmation failed. Please try again.' };
      }
    }
    return { success: false, message: 'Email and confirmation code are required.' };
  };

  const logout = () => {
    setIsAuthenticated(false);
  };

  const checkInviteLink = (): boolean => {
    // Check if there's an invitation parameter in the URL
    const urlParams = new URLSearchParams(window.location.search);
    const invitationId = urlParams.get('join');
    
    // In a real app, we would check if this invitationId is valid
    // and corresponds to an online client
    // For now, we'll just check if the parameter exists
    return invitationId !== null && invitationId !== '';
  };

  return (
    <AuthContext.Provider value={{ isAuthenticated, login, logout, checkInviteLink, register, confirmRegistration }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
