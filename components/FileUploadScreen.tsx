
import React, { useState, useCallback } from 'react';
import { extractTextFromFile } from '../utils/fileReader';
import { UploadIcon, FileTextIcon, CheckCircleIcon, Spinner } from './icons';

interface FileUploadScreenProps {
  onFilesReady: (jobDescription: string, resume: string) => void;
}

const FileUpload: React.FC<{
    id: string;
    label: string;
    onFileUpload: (file: File) => void;
    fileState: { file: File | null, loading: boolean, text: string | null };
}> = ({ id, label, onFileUpload, fileState }) => {
    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            onFileUpload(e.target.files[0]);
        }
    };
    
    return (
        <div className="w-full">
            <label htmlFor={id} className="block text-sm font-medium text-gray-700 mb-2">{label}</label>
            <div className="mt-2 flex justify-center rounded-lg border border-dashed border-gray-300 px-6 py-10 hover:border-blue-500 transition-colors">
                <div className="text-center">
                    {fileState.loading ? (
                        <Spinner className="mx-auto h-12 w-12 text-blue-500" />
                    ) : fileState.file ? (
                        <CheckCircleIcon className="mx-auto h-12 w-12 text-green-500" />
                    ) : (
                        <UploadIcon className="mx-auto h-12 w-12 text-gray-400" />
                    )}
                    <div className="mt-4 flex text-sm leading-6 text-gray-600">
                        <label htmlFor={id} className="relative cursor-pointer rounded-md font-semibold text-blue-600 focus-within:outline-none focus-within:ring-2 focus-within:ring-blue-500 focus-within:ring-offset-2 focus-within:ring-offset-gray-100 hover:text-blue-500">
                            <span>Upload a file</span>
                            <input id={id} name={id} type="file" className="sr-only" onChange={handleFileChange} accept=".txt,.pdf,.docx" />
                        </label>
                        <p className="pl-1">or drag and drop</p>
                    </div>
                     <p className="text-xs leading-5 text-gray-500">TXT, PDF, DOCX</p>
                    {fileState.file && !fileState.loading && (
                        <div className="mt-2 text-xs flex items-center justify-center text-green-600">
                           <FileTextIcon className="h-4 w-4 mr-1"/> {fileState.file.name}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};


const FileUploadScreen: React.FC<FileUploadScreenProps> = ({ onFilesReady }) => {
  const [jdState, setJdState] = useState<{ file: File | null, loading: boolean, text: string | null }>({ file: null, loading: false, text: null });
  const [resumeState, setResumeState] = useState<{ file: File | null, loading: boolean, text: string | null }>({ file: null, loading: false, text: null });
  const [error, setError] = useState<string>('');

  const processFile = useCallback(async (
    file: File, 
    setter: React.Dispatch<React.SetStateAction<{ file: File | null, loading: boolean, text: string | null }>>
  ) => {
    setter({ file, loading: true, text: null });
    setError('');
    try {
      const text = await extractTextFromFile(file);
      setter({ file, loading: false, text });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unknown error occurred');
      setter({ file: null, loading: false, text: null });
    }
  }, []);

  const handleStartInterview = () => {
    if (jdState.text && resumeState.text) {
      onFilesReady(jdState.text, resumeState.text);
    }
  };

  const isReady = jdState.text && resumeState.text;

  return (
    <div className="flex flex-col items-center justify-center h-full">
      <h2 className="text-2xl font-semibold text-gray-900 mb-6">Setup Your Interview</h2>
      <p className="text-gray-600 mb-8 text-center max-w-2xl">
        Upload the Job Description for the role you're hiring for, and the resume of the candidate persona you want to interview.
      </p>
      <div className="w-full max-w-3xl grid grid-cols-1 md:grid-cols-2 gap-8 mb-8">
         <FileUpload id="jd-upload" label="Job Description" onFileUpload={(file) => processFile(file, setJdState)} fileState={jdState} />
         <FileUpload id="resume-upload" label="Candidate Resume" onFileUpload={(file) => processFile(file, setResumeState)} fileState={resumeState} />
      </div>

      {error && <p className="text-red-500 mt-4">{error}</p>}

      <button
        onClick={handleStartInterview}
        disabled={!isReady}
        className="mt-8 px-8 py-3 bg-orange-500 text-white font-semibold rounded-lg shadow-md hover:bg-orange-600 disabled:bg-orange-300 disabled:cursor-not-allowed transition-all focus:outline-none focus:ring-2 focus:ring-orange-500 focus:ring-offset-2 focus:ring-offset-white"
      >
        Start Interview
      </button>
    </div>
  );
};

export default FileUploadScreen;