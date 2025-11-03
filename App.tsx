
import React, { useState } from 'react';
import { AppState, Feedback } from './types';
import FileUploadScreen from './components/FileUploadScreen';
import InterviewScreen from './components/InterviewScreen';
import FeedbackScreen from './components/FeedbackScreen';

const App: React.FC = () => {
  const [appState, setAppState] = useState<AppState>(AppState.SETUP);
  const [jobDescription, setJobDescription] = useState<string>('');
  const [resume, setResume] = useState<string>('');
  const [transcript, setTranscript] = useState<string>('');
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  const handleInterviewStart = (jd: string, cv: string) => {
    setJobDescription(jd);
    setResume(cv);
    setAppState(AppState.INTERVIEWING);
  };

  const handleInterviewEnd = (finalTranscript: string, finalFeedback: Feedback) => {
    setTranscript(finalTranscript);
    setFeedback(finalFeedback);
    setAppState(AppState.FEEDBACK);
  };
  
  const handleReset = () => {
    setJobDescription('');
    setResume('');
    setTranscript('');
    setFeedback(null);
    setAppState(AppState.SETUP);
  };

  const renderContent = () => {
    switch (appState) {
      case AppState.SETUP:
        return <FileUploadScreen onFilesReady={handleInterviewStart} />;
      case AppState.INTERVIEWING:
        return <InterviewScreen jobDescription={jobDescription} resume={resume} onInterviewEnd={handleInterviewEnd} />;
      case AppState.FEEDBACK:
        return feedback ? <FeedbackScreen feedback={feedback} transcript={transcript} onReset={handleReset} /> : null;
      default:
        return <FileUploadScreen onFilesReady={handleInterviewStart} />;
    }
  };

  return (
    <div className="min-h-screen bg-gray-100 text-gray-800 flex flex-col items-center justify-center p-4 font-sans">
      <div className="w-full max-w-4xl mx-auto">
        <header className="text-center mb-8">
          <h1 className="text-4xl md:text-5xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-blue-600 to-orange-500">
            EPS Mock Interview Coach
          </h1>
          <p className="text-gray-600 mt-2">Practice your technical interviewing skills with a Gemini-powered AI candidate.</p>
        </header>
        <main className="bg-white rounded-2xl shadow-xl p-6 md:p-8 min-h-[60vh] flex flex-col">
          {renderContent()}
        </main>
        <footer className="text-center mt-8 text-gray-500 text-sm">
          <p>Powered by Google Gemini 2.5 Native Audio</p>
        </footer>
      </div>
    </div>
  );
};

export default App;