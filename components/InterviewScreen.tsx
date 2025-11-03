import React, { useState, useEffect, useRef, useCallback } from 'react';
// FIX: Removed 'LiveSession' as it is not an exported member of '@google/genai'.
import { GoogleGenAI, LiveServerMessage, Modality, Type } from '@google/genai';
import { TranscriptTurn, Feedback } from '../types';
import { PERSONA_RULES, FEEDBACK_GUIDELINES } from '../constants';
import { encode, decode, decodeAudioData } from '../utils/audio';
import { MicrophoneIcon, StopIcon, Spinner } from './icons';

interface InterviewScreenProps {
  jobDescription: string;
  resume: string;
  onInterviewEnd: (transcript: string, feedback: Feedback) => void;
}

const InterviewScreen: React.FC<InterviewScreenProps> = ({ jobDescription, resume, onInterviewEnd }) => {
  const [isConnecting, setIsConnecting] = useState(true);
  const [isMicOn, setIsMicOn] = useState(false);
  const [transcript, setTranscript] = useState<TranscriptTurn[]>([]);
  const [status, setStatus] = useState('Connecting to AI...');
  
  // FIX: Replaced 'LiveSession' with 'any' since the type is not exported from the library.
  const sessionPromiseRef = useRef<Promise<any> | null>(null);
  const inputAudioContextRef = useRef<AudioContext | null>(null);
  const outputAudioContextRef = useRef<AudioContext | null>(null);
  const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const mediaStreamSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  
  const currentInputTranscriptionRef = useRef('');
  const currentOutputTranscriptionRef = useRef('');
  const nextStartTimeRef = useRef(0);
  const audioSourcesRef = useRef(new Set<AudioBufferSourceNode>());

  const addTranscriptTurn = useCallback((turn: TranscriptTurn) => {
    setTranscript(prev => {
        if (turn.isPartial) {
            const lastTurn = prev[prev.length - 1];
            if (lastTurn && lastTurn.speaker === turn.speaker && lastTurn.isPartial) {
                const newTurn = { ...lastTurn, text: lastTurn.text + turn.text };
                return [...prev.slice(0, -1), newTurn];
            }
        } else if (turn.text.trim()) {
             const lastTurn = prev[prev.length - 1];
             if(lastTurn && lastTurn.speaker === turn.speaker && lastTurn.isPartial) {
                return [...prev.slice(0, -1), { ...turn, isPartial: false }];
             }
        }
        if(turn.text.trim()){
            return [...prev, turn];
        }
        return prev;
    });
  }, []);

  const stopMicrophone = useCallback(() => {
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
    
    // Generate feedback
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY as string });
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
  }, [transcript, stopMicrophone, onInterviewEnd]);

  useEffect(() => {
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
        
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY as string });
    
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
                if(message.serverContent?.inputTranscription) {
                    const { text } = message.serverContent.inputTranscription;
                    currentInputTranscriptionRef.current += text;
                    addTranscriptTurn({ speaker: 'Interviewer', text: text, isPartial: true });
                }
                
                if(message.serverContent?.outputTranscription) {
                    const { text } = message.serverContent.outputTranscription;
                    currentOutputTranscriptionRef.current += text;
                    addTranscriptTurn({ speaker: 'Candidate', text: text, isPartial: true });
                }

                if (message.serverContent?.turnComplete) {
                    addTranscriptTurn({ speaker: 'Interviewer', text: currentInputTranscriptionRef.current, isPartial: false });
                    if (currentInputTranscriptionRef.current.toLowerCase().includes('end interview')) {
                        endInterview();
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
                setStatus('Interview session closed.');
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
    
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    inputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
    const source = inputAudioContextRef.current.createMediaStreamSource(stream);
    mediaStreamSourceRef.current = source;

    const scriptProcessor = inputAudioContextRef.current.createScriptProcessor(4096, 1, 1);
    scriptProcessorRef.current = scriptProcessor;

    scriptProcessor.onaudioprocess = (event) => {
        const inputData = event.inputBuffer.getChannelData(0);
        const l = inputData.length;
        const int16 = new Int16Array(l);
        for (let i = 0; i < l; i++) {
            int16[i] = inputData[i] * 32768;
        }
        const pcmBlob = {
            data: encode(new Uint8Array(int16.buffer)),
            mimeType: 'audio/pcm;rate=16000',
        };
        sessionPromiseRef.current?.then(session => {
            session.sendRealtimeInput({ media: pcmBlob });
        });
    };
    
    source.connect(scriptProcessor);
    scriptProcessor.connect(inputAudioContextRef.current.destination);
  };
  
  const transcriptRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (transcriptRef.current) {
      transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
    }
  }, [transcript]);

  return (
    <div className="flex flex-col h-full">
        <div className="flex-grow bg-gray-900/50 rounded-lg p-4 overflow-y-auto mb-4 min-h-[40vh]" ref={transcriptRef}>
            {transcript.map((turn, index) => (
                <div key={index} className={`mb-3 ${turn.speaker === 'Interviewer' ? 'text-right' : 'text-left'}`}>
                    <div className={`inline-block p-3 rounded-xl max-w-xl ${
                        turn.speaker === 'Interviewer' ? 'bg-blue-600 text-white rounded-br-none' :
                        turn.speaker === 'Candidate' ? 'bg-gray-700 text-gray-200 rounded-bl-none' :
                        'bg-yellow-800 text-yellow-100 text-center w-full'
                    }`}>
                        <p className="font-bold text-sm mb-1">{turn.speaker}</p>
                        <p>{turn.text}</p>
                    </div>
                </div>
            ))}
        </div>
      <div className="flex-shrink-0 flex flex-col items-center">
        <p className="text-gray-400 mb-4 h-6">{status}</p>
        <button
          onClick={isMicOn ? () => endInterview() : startMicrophone}
          disabled={isConnecting}
          className={`relative w-20 h-20 rounded-full flex items-center justify-center transition-all duration-300
            ${isConnecting ? 'bg-gray-600 cursor-not-allowed' : 
            isMicOn ? 'bg-red-600 hover:bg-red-500 shadow-[0_0_20px_5px] shadow-red-500/50' : 
            'bg-green-600 hover:bg-green-500 shadow-[0_0_20px_5px] shadow-green-500/50'}`}
        >
          {isConnecting ? <Spinner className="w-8 h-8 text-white"/> : isMicOn ? <StopIcon className="w-8 h-8 text-white" /> : <MicrophoneIcon className="w-8 h-8 text-white" />}
        </button>
        <button onClick={endInterview} className="mt-4 text-gray-400 hover:text-red-400 text-sm">End Interview & Get Feedback</button>
      </div>
    </div>
  );
};

export default InterviewScreen;