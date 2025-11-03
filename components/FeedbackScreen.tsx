
import React from 'react';
import { Feedback } from '../types';

interface FeedbackScreenProps {
  feedback: Feedback;
  transcript: string;
  onReset: () => void;
}

const FeedbackScreen: React.FC<FeedbackScreenProps> = ({ feedback, transcript, onReset }) => {
  return (
    <div className="flex flex-col items-center h-full animate-fade-in">
      <h2 className="text-3xl font-bold text-gray-900 mb-4">Interview Feedback</h2>
      <div className="w-full max-w-3xl bg-white rounded-lg p-6 shadow-md">
        <div className="flex items-center gap-6 mb-6 pb-6 border-b border-gray-200">
            <div className="flex flex-col items-center justify-center bg-blue-600 text-white w-32 h-32 rounded-full shadow-lg">
                <span className="text-lg font-medium">Grade</span>
                <span className="text-6xl font-bold">{feedback.grade}</span>
            </div>
            <div className="flex-1">
                <h3 className="text-xl font-semibold text-gray-800 mb-2">Interviewer Performance Review</h3>
                <p className="text-gray-600">
                    Here is the AI's assessment of your performance based on the provided interview guidelines.
                </p>
            </div>
        </div>

        <div className="prose prose-p:text-gray-700 prose-headings:text-gray-800 max-w-none text-left">
            <h4 className="font-semibold text-lg mb-2">Detailed Feedback:</h4>
            {/* Using a pre-wrap div to render markdown-like text with newlines */}
            <div className="p-4 bg-gray-100 rounded-md">
                 <p className="whitespace-pre-wrap">{feedback.feedback}</p>
            </div>
        </div>
      </div>
      
      <div className="w-full max-w-3xl mt-6">
        <details className="bg-white rounded-lg p-4 cursor-pointer shadow-md">
            <summary className="font-semibold text-gray-700">View Full Transcript</summary>
            <pre className="mt-4 text-sm text-gray-600 whitespace-pre-wrap max-h-60 overflow-y-auto p-2 bg-gray-100 rounded">{transcript}</pre>
        </details>
      </div>

      <button
        onClick={onReset}
        className="mt-8 px-8 py-3 bg-blue-600 text-white font-semibold rounded-lg shadow-md hover:bg-blue-700 transition-all focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-gray-100"
      >
        Start New Interview
      </button>
    </div>
  );
};

export default FeedbackScreen;