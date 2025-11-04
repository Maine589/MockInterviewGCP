import React, { useState, useEffect, useRef, useCallback } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality, Type, Blob } from '@google/genai';
import { TranscriptTurn, Feedback } from '../types';
import { PERSONA_RULES, FEEDBACK_GUIDELINES } from '../constants';
import { encode, decode, decodeAudioData } from '../utils/audio';
import { MicrophoneIcon, PauseIcon, PlayIcon, Spinner } from './icons';

interface InterviewScreenProps {
  jobDescription: string;
  resume: string;
  onInterviewEnd: (transcript: string, feedback: Feedback) => void;
}

const InterviewScreen: React.FC<InterviewScreenProps> = ({ jobDescription, resume, onInterviewEnd }) => {
  const [isConnecting, setIsConnecting] = useState(true);
  const [isMicOn, setIsMicOn] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [transcript, setTranscript] = useState<TranscriptTurn[]>([]);
  const [status, setStatus] = useState('Connecting to AI...');
  
  const sessionPromiseRef = useRef<Promise<any> | null>(null);
  const inputAudioContextRef = useRef<AudioContext | null>(null);
  const outputAudioContextRef = useRef<AudioContext | null>(null);
  const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const mediaStreamSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  
  const currentInputTranscriptionRef = useRef('');
  const currentOutputTranscriptionRef = useRef('');
  const nextStartTimeRef = useRef(0);
  const audioSourcesRef = useRef(new Set<AudioBufferSourceNode>());
  const isPausedRef = useRef(isPaused);
  const isEndingRef = useRef(false);

  useEffect(() => {
    isPausedRef.current = isPaused;
  }, [isPaused]);


  const addTranscriptTurn = useCallback((turn: TranscriptTurn) => {
    setTranscript(prev => {
        const newTranscript = [...prev];
        let lastTurnForSpeakerIndex = -1;
        for (let i = newTranscript.length - 1; i >= 0; i--) {
            if (newTranscript[i].speaker === turn.speaker) {
                lastTurnForSpeakerIndex = i;
                break;
            }
        }

        const lastTurnForSpeaker = lastTurnForSpeakerIndex !== -1 ? newTranscript[lastTurnForSpeakerIndex] : null;

        if (turn.isPartial && lastTurnForSpeaker && lastTurnForSpeaker.isPartial) {
            newTranscript[lastTurnForSpeakerIndex] = turn;
            return newTranscript;
        }

        if (!turn.isPartial && lastTurnForSpeaker && lastTurnForSpeaker.isPartial) {
            if (turn.text.trim()) {
                newTranscript[lastTurnForSpeakerIndex] = turn;
            } else {
                newTranscript.splice(lastTurnForSpeakerIndex, 1);
            }
            return newTranscript;
        }

        if (turn.text.trim()) {
            return [...prev, turn];
        }

        return prev;
    });
  }, []);

  const stopMicrophone = useCallback(() => {
    mediaStreamRef.current?.getTracks().forEach(track => track.stop());
    mediaStreamRef.current = null;

    if (mediaStreamSourceRef.current) {
        mediaStreamSourceRef.current.disconnect();
        mediaStreamSourceRef.current = null;
    }
    if (scriptProcessorRef.current) {
        scriptProcessorRef.current.disconnect();
        scriptProcessorRef.current.onaudioprocess = null;
        scriptProcessorRef.current = null;
    }
    if (inputAudioContextRef.current && inputAudioContextRef.current.state !== 'closed') {
      inputAudioContextRef.current.close();
      inputAudioContextRef.current = null;
    }
    setIsMicOn(false);
  }, []);

  const endInterview = useCallback(async () => {
    if (isEndingRef.current) return;
    isEndingRef.current = true;

    setStatus('Interview ended. Generating feedback...');
    stopMicrophone();

    if(sessionPromiseRef.current) {
        const session = await sessionPromiseRef.current;
        session.close();
    }
    if (outputAudioContextRef.current && outputAudioContextRef.current.state !== 'closed') {
        outputAudioContextRef.current.close();
    }

    const finalTranscript = transcript.map(t => `${t.speaker}: ${t.text}`).join('\n');
    
    // Gracefully handle missing API key
    if (!process.env.API_KEY) {
        const noKeyFeedback: Feedback = {
            grade: 'N/A',
            feedback: 'Could not generate feedback because the API Key is not configured. Please add your VITE_API_KEY to the .env.local file and restart the server.'
        };
        onInterviewEnd(finalTranscript, noKeyFeedback);
        return;
    }
    
    // Generate feedback
    try {
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
        const response = await ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: `Based on these guidelines:\n${FEEDBACK_GUIDELINES}\n\nAnd this interview transcript:\n${finalTranscript}\n\nPlease provide your feedback.`,
            config: {
                responseMimeType: "application/json",
                responseSchema: {
                    type: Type.OBJECT,
                    properties: {
                        grade: { type: Type.STRING },
                        feedback: { type: Type.STRING }
                    },
                    required: ['grade', 'feedback']
                }
            }
        });
        
        const feedbackText = response.text;
        const feedbackJson = JSON.parse(feedbackText) as Feedback;
        onInterviewEnd(finalTranscript, feedbackJson);
    } catch (error) {
        console.error("Error generating feedback:", error);
        const errorFeedback: Feedback = {
            grade: 'Error',
            feedback: `An error occurred while generating feedback. Please check the console for details. This may be due to an invalid API key or a network issue.`
        };
        onInterviewEnd(finalTranscript, errorFeedback);
    }
  }, [transcript, stopMicrophone, onInterviewEnd]);

  useEffect(() => {
    if (!process.env.API_KEY) {
      setStatus('API Key is not configured. Please check your .env.local file.');
      addTranscriptTurn({ speaker: 'System', text: 'Configuration Error: API Key is missing.'});
      setIsConnecting(false);
      return;
    }
    
    const systemInstruction = `You are an AI role-play assistant. Your persona comes from the resume that is provided. You will act as a software engineer candidate. The user is the "Hiring Manager".
        
        This is the Job Description for the role:
        --- START JOB DESCRIPTION ---
        ${jobDescription}
        --- END JOB DESCRIPTION ---
        
        This is your resume. You must fully adopt this persona.
        --- START RESUME ---
        ${resume}
        --- END RESUME ---
        
        ${PERSONA_RULES}`;
        
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    
    outputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });

    const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-09-2025',
        config: {
            systemInstruction: systemInstruction,
            responseModalities: [Modality.AUDIO],
            inputAudioTranscription: {},
            outputAudioTranscription: {},
            speechConfig: {
                voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Zephyr' } },
            },
        },
        callbacks: {
            onopen: () => {
                setIsConnecting(false);
                setStatus('Ready. Click the microphone to start.');
            },
            onmessage: async (message: LiveServerMessage) => {
                if (isEndingRef.current) return;

                if(message.serverContent?.inputTranscription) {
                    const { text } = message.serverContent.inputTranscription;
                    currentInputTranscriptionRef.current += text;
                    addTranscriptTurn({ speaker: 'Interviewer', text: currentInputTranscriptionRef.current, isPartial: true });
                }
                
                if(message.serverContent?.outputTranscription) {
                    const { text } = message.serverContent.outputTranscription;
                    currentOutputTranscriptionRef.current += text;
                    addTranscriptTurn({ speaker: 'Candidate', text: currentOutputTranscriptionRef.current, isPartial: true });
                }

                if (message.serverContent?.turnComplete) {
                    addTranscriptTurn({ speaker: 'Interviewer', text: currentInputTranscriptionRef.current, isPartial: false });
                    if (currentInputTranscriptionRef.current.toLowerCase().includes('end interview')) {
                        endInterview();
                        return; // Stop processing further messages
                    }
                    currentInputTranscriptionRef.current = '';

                    addTranscriptTurn({ speaker: 'Candidate', text: currentOutputTranscriptionRef.current, isPartial: false });
                    currentOutputTranscriptionRef.current = '';
                }

                const audioData = message.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
                if (audioData && outputAudioContextRef.current) {
                    const outputCtx = outputAudioContextRef.current;
                    nextStartTimeRef.current = Math.max(nextStartTimeRef.current, outputCtx.currentTime);
                    const audioBuffer = await decodeAudioData(decode(audioData), outputCtx, 24000, 1);
                    const source = outputCtx.createBufferSource();
                    source.buffer = audioBuffer;
                    source.connect(outputCtx.destination);
                    source.addEventListener('ended', () => audioSourcesRef.current.delete(source));
                    source.start(nextStartTimeRef.current);
                    nextStartTimeRef.current += audioBuffer.duration;
                    audioSourcesRef.current.add(source);
                }

                if (message.serverContent?.interrupted) {
                    for (const source of audioSourcesRef.current.values()) {
                        source.stop();
                    }
                    audioSourcesRef.current.clear();
                    nextStartTimeRef.current = 0;
                }
            },
            onerror: (e: ErrorEvent) => {
                console.error(e);
                setStatus(`Connection Error: ${e.message}`);
                addTranscriptTurn({ speaker: 'System', text: `Error: ${e.message}`});
                setIsConnecting(false);
            },
            onclose: (e: CloseEvent) => {
                if (!isEndingRef.current) {
                  setStatus('Interview session closed.');
                }
            }
        }
    });

    sessionPromiseRef.current = sessionPromise;

    return () => {
        stopMicrophone();
        if (sessionPromiseRef.current) {
            sessionPromiseRef.current.then(session => session.close());
        }
        if (outputAudioContextRef.current && outputAudioContextRef.current.state !== 'closed') {
            outputAudioContextRef.current.close();
        }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobDescription, resume]);


  const startMicrophone = async () => {
    if (isConnecting || !sessionPromiseRef.current) return;
    
    setStatus('Listening...');
    addTranscriptTurn({ speaker: 'System', text: 'Interview started.' });
    setIsMicOn(true);
    setIsPaused(false);
    
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaStreamRef.current = stream;
    inputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
    const source = inputAudioContextRef.current.createMediaStreamSource(stream);
    mediaStreamSourceRef.current = source;

    const scriptProcessor = inputAudioContextRef.current.createScriptProcessor(4096, 1, 1);
    scriptProcessorRef.current = scriptProcessor;

    scriptProcessor.onaudioprocess = (event) => {
        if(isPausedRef.current || isEndingRef.current) return;

        const inputData = event.inputBuffer.getChannelData(0);
        const l = inputData.length;
        const int16 = new Int16Array(l);
        for (let i = 0; i < l; i++) {
            int16[i] = inputData[i] * 32768;
        }
        const pcmBlob: Blob = {
            data: encode(new Uint8Array(int16.buffer)),
            mimeType: 'audio/pcm;rate=16000',
        };
        sessionPromiseRef.current?.then(session => {
            if (!isEndingRef.current) {
               session.sendRealtimeInput({ media: pcmBlob });
            }
        });
    };
    
    source.connect(scriptProcessor);
    scriptProcessor.connect(inputAudioContextRef.current.destination);
  };
  
  const togglePause = useCallback(() => {
    setIsPaused(prev => {
        const isNowPaused = !prev;
        if (isNowPaused) {
            setStatus('Paused');
            outputAudioContextRef.current?.suspend();
        } else {
            setStatus('Listening...');
            outputAudioContextRef.current?.resume();
        }
        return isNowPaused;
    });
  }, []);

  const handleMainButtonClick = () => {
    if (!isMicOn) {
        startMicrophone();
    } else {
        togglePause();
    }
  };

  const transcriptRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (transcriptRef.current) {
      transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
    }
  }, [transcript]);

  return (
    <div className="flex flex-col h-full">
        <div className="flex-grow bg-gray-200/75 rounded-lg p-4 overflow-y-auto mb-4 min-h-[40vh]" ref={transcriptRef}>
            {transcript.map((turn, index) => (
                <div key={index} className={`mb-3 ${turn.speaker === 'Interviewer' ? 'text-right' : 'text-left'}`}>
                    <div className={`inline-block p-3 rounded-xl max-w-xl ${
                        turn.speaker === 'Interviewer' ? 'bg-blue-600 text-white rounded-br-none' :
                        turn.speaker === 'Candidate' ? 'bg-gray-300 text-gray-800 rounded-bl-none' :
                        'bg-yellow-200 text-yellow-800 text-center w-full'
                    }`}>
                        <p className="font-bold text-sm mb-1">{turn.speaker}</p>
                        <p>{turn.text}</p>
                    </div>
                </div>
            ))}
        </div>
      <div className="flex-shrink-0 flex flex-col items-center">
        <p className="text-gray-600 mb-4 h-6">{status}</p>
        <div className="flex items-center justify-center h-20">
          <button
            onClick={handleMainButtonClick}
            disabled={isConnecting}
            className={`relative w-20 h-20 rounded-full flex items-center justify-center transition-all duration-300
              ${isConnecting ? 'bg-gray-500 cursor-not-allowed' : 
              !isMicOn || isPaused ? 'bg-green-600 hover:bg-green-700 shadow-[0_0_20px_5px] shadow-green-500/30' : 
              'bg-orange-500 hover:bg-orange-600 shadow-[0_0_20px_5px] shadow-orange-500/30'}`}
          >
            {isConnecting ? <Spinner className="w-8 h-8 text-white"/> : 
              !isMicOn ? <MicrophoneIcon className="w-8 h-8 text-white" /> : 
              isPaused ? <PlayIcon className="w-8 h-8 text-white" /> :
              <PauseIcon className="w-8 h-8 text-white" />
            }
          </button>
          {isMicOn && (
            <button 
                onClick={endInterview}
                className="ml-6 px-5 py-3 bg-red-600 text-white font-semibold rounded-lg shadow-md hover:bg-red-700 transition-all focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 focus:ring-offset-gray-100"
            >
                End Interview
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default InterviewScreen;