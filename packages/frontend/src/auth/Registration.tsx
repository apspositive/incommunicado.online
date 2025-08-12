import React, { useState } from 'react';
import { useAuth } from './AuthContext';

const Registration: React.FC = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [confirmationCode, setConfirmationCode] = useState('');
  const [step, setStep] = useState<'register' | 'confirm' | 'success'>('register');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  
  const { register, confirmRegistration } = useAuth();

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setMessage('');
    
    // Validate password match
    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    
    try {
      const result = await register(email, password);
      if (result.success) {
        setMessage(result.message);
        setStep('confirm');
      } else {
        setError(result.message);
      }
    } catch (err) {
      setError('An error occurred during registration');
    }
  };

  const handleConfirm = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setMessage('');
    
    try {
      const result = await confirmRegistration(email, confirmationCode);
      if (result.success) {
        setMessage(result.message);
        setStep('success');
      } else {
        setError(result.message);
      }
    } catch (err) {
      setError('An error occurred during confirmation');
    }
  };

  return (
    <div className="registration-container">
      <div className="registration-form">
        <h2>{step === 'register' ? 'Register' : step === 'confirm' ? 'Confirm Registration' : 'Registration Complete'}</h2>
        
        {message && <div className="success-message">{message}</div>}
        {error && <div className="error-message">{error}</div>}
        
        {step === 'register' && (
          <form onSubmit={handleRegister}>
            <div className="form-group">
              <label htmlFor="email">Email</label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="form-group">
              <label htmlFor="password">Password</label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            <div className="form-group">
              <label htmlFor="confirmPassword">Confirm Password</label>
              <input
                id="confirmPassword"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
              />
            </div>
            <button type="submit">Register</button>
          </form>
        )}
        
        {step === 'confirm' && (
          <form onSubmit={handleConfirm}>
            <div className="form-group">
              <label htmlFor="confirmationCode">Confirmation Code</label>
              <input
                id="confirmationCode"
                type="text"
                value={confirmationCode}
                onChange={(e) => setConfirmationCode(e.target.value)}
                required
              />
              <p className="info-text">Please check your email for the confirmation code.</p>
            </div>
            <button type="submit">Confirm Registration</button>
          </form>
        )}
        
        {step === 'success' && (
          <div className="success-content">
            <p>Your registration has been confirmed and is awaiting admin approval.</p>
            <p>You will receive an email when your account is approved.</p>
          </div>
        )}
        
        <div className="registration-info">
          <p>Note: Registration requires email confirmation and admin approval.</p>
        </div>
      </div>
    </div>
  );
};

export default Registration;
