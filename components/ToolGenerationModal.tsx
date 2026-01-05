import React, { useEffect, useState, useMemo, useReducer } from 'react';
import { useAppContext } from '../context/AppContext';
import { Button } from './common/Button';
import { Card } from './common/Card';
import { Spinner } from './common/Spinner';
import { Skeleton } from './common/Skeleton';
import { DynamicIcon } from './icons/DynamicIcon';
import { ToolIdea, WordPressPost } from '../types';
import { CheckIcon } from './icons/CheckIcon';
import { EyeIcon, CodeBracketIcon } from './icons/ToolIcons';
import { XCircleIcon } from './icons/XCircleIcon';
import * as aiService from '../services/aiService';
import { AI_PROVIDERS } from '../constants';
import { useDebounce } from '../hooks/useDebounce';

type ModalStatus = 'idle' | 'loading_ideas' | 'generating_snippet' | 'inserting_snippet' | 'error' | 'success';

interface ModalState {
    status: ModalStatus;
    error: string | null;
    toolIdeas: ToolIdea[];
    selectedIdea: ToolIdea | null;
    generatedSnippet: string;
    editedSnippet: string;
}

type ModalAction =
    | { type: 'GET_IDEAS_START' }
    | { type: 'GET_IDEAS_SUCCESS'; payload: ToolIdea[] }
    | { type: 'GET_IDEAS_FAILURE'; payload: string }
    | { type: 'SELECT_IDEA'; payload: ToolIdea }
    | { type: 'GENERATE_SNIPPET_START' }
    | { type: 'GENERATE_SNIPPET_STREAM'; payload: string }
    | { type: 'GENERATE_SNIPPET_END' }
    | { type: 'GENERATE_SNIPPET_FAILURE'; payload: string }
    | { type: 'EDIT_SNIPPET'; payload: string }
    | { type: 'INSERT_SNIPPET_START' }
    | { type: 'INSERT_SNIPPET_SUCCESS' }
    | { type: 'INSERT_SNIPPET_FAILURE'; payload: string };

const initialState: ModalState = {
    status: 'idle',
    error: null,
    toolIdeas: [],
    selectedIdea: null,
    generatedSnippet: '',
    editedSnippet: '',
};

function modalReducer(state: ModalState, action: ModalAction): ModalState {
    switch(action.type) {
        case 'GET_IDEAS_START':
            return { ...state, status: 'loading_ideas', error: null, toolIdeas: [] };
        case 'GET_IDEAS_SUCCESS':
            return { ...state, status: 'idle', toolIdeas: action.payload };
        case 'GET_IDEAS_FAILURE':
            return { ...state, status: 'error', error: action.payload };
        case 'SELECT_IDEA':
            return { ...state, selectedIdea: action.payload };
        case 'GENERATE_SNIPPET_START':
            return { ...state, status: 'generating_snippet', generatedSnippet: '', editedSnippet: '', error: null };
        case 'GENERATE_SNIPPET_STREAM':
            const newSnippet = state.generatedSnippet + action.payload;
            return { ...state, generatedSnippet: newSnippet, editedSnippet: newSnippet };
        case 'GENERATE_SNIPPET_END':
            return { ...state, status: 'idle' };
        case 'GENERATE_SNIPPET_FAILURE':
            return { ...state, status: 'error', error: action.payload };
        case 'EDIT_SNIPPET':
            return { ...state, editedSnippet: action.payload };
        case 'INSERT_SNIPPET_START':
            return { ...state, status: 'inserting_snippet', error: null };
        case 'INSERT_SNIPPET_SUCCESS':
            return { ...state, status: 'success' };
        case 'INSERT_SNIPPET_FAILURE':
            return { ...state, status: 'error', error: action.payload };
        default:
            return state;
    }
}

const loadingMessages = [
    "Analyzing post for key topics...",
    "Brainstorming engaging tool concepts...",
    "Evaluating potential for SEO lift...",
    "Cross-referencing with content strategy...",
    "Finalizing creative ideas..."
];

const IdeaCard: React.FC<{ idea: ToolIdea, onSelect: () => void, isSelected: boolean }> = ({ idea, onSelect, isSelected }) => (
    <button onClick={onSelect} className={`w-full text-left transition-all duration-300 ease-out rounded-xl focus:outline-none focus-visible:ring-4 focus-visible:ring-blue-500/50 ${isSelected ? 'shadow-2xl shadow-blue-500/20' : ''}`}>
        <Card className={`h-full flex flex-col justify-between text-left transition-all group ${isSelected ? '!border-blue-500' : ''}`}>
            <div>
                <div className="flex items-center gap-3">
                    <span className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center transition-colors ${isSelected ? 'bg-blue-600' : 'bg-blue-100 dark:bg-blue-900/50'}`}>
                        <DynamicIcon name={idea.icon} className={`w-5 h-5 transition-colors ${isSelected ? 'text-white' : 'text-blue-600 dark:text-blue-400'}`} />
                    </span>
                    <h3 className="font-bold text-lg text-slate-800 dark:text-slate-100">{idea.title}</h3>
                </div>
                <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">{idea.description}</p>
            </div>
        </Card>
    </button>
);

const SkeletonIdeaCard: React.FC = () => (
    <Card className="space-y-4">
        <div className="flex items-center gap-3">
            <Skeleton className="w-8 h-8 rounded-full" />
            <Skeleton className="h-6 w-3/4" />
        </div>
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
    </Card>
);

const hexToHsl = (hex: string): { h: number, s: number, l: number } | null => {
    if (!hex || typeof hex !== 'string') return null;
    let r = 0, g = 0, b = 0;
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    if(result){
        r = parseInt(result[1], 16); g = parseInt(result[2], 16); b = parseInt(result[3], 16);
    } else {
        const shorthandResult = /^#?([a-f\d])([a-f\d])([a-f\d])$/i.exec(hex);
        if(shorthandResult){
            r = parseInt(shorthandResult[1] + shorthandResult[1], 16); g = parseInt(shorthandResult[2] + shorthandResult[2], 16); b = parseInt(shorthandResult[3] + shorthandResult[3], 16);
        } else { return null; }
    }
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0, s = 0, l = (max + min) / 2;
    if (max !== min) {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        switch (max) {
            case r: h = (g - b) / d + (g < b ? 6 : 0); break;
            case g: h = (b - r) / d + 2; break;
            case b: h = (r - g) / d + 4; break;
        }
        h /= 6;
    }
    return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
}

interface ToolGenerationModalProps {
    post: WordPressPost;
    onClose: () => void;
}

const ToolGenerationModalComponent: React.FC<ToolGenerationModalProps> = ({ post, onClose }) => {
    const { state: globalState, insertSnippet } = useAppContext();
    const [modalState, dispatch] = useReducer(modalReducer, initialState);
    const { status, error, toolIdeas, selectedIdea, editedSnippet } = modalState;

    const [loadingMessage, setLoadingMessage] = useState(loadingMessages[0]);
    const [activeTab, setActiveTab] = useState<'code' | 'preview'>('code');
    const [iframeSrcDoc, setIframeSrcDoc] = useState('');
    const [themeColor, setThemeColor] = useState('#3b82f6'); // Default blue

    // SOTA Optimization: During streaming, do not debounce the preview update. 
    // This allows the preview to update in near real-time without thrashing the CPU,
    // or we can choose to throttle it. Here we use standard debounce which is safer for iframes.
    const debouncedSnippet = useDebounce(editedSnippet, 300);

    const isGeneratingIdeas = status === 'loading_ideas';
    const isStreaming = status === 'generating_snippet';
    const isInserting = status === 'inserting_snippet';
    const isLoading = isGeneratingIdeas || isStreaming || isInserting;

    const currentStage = useMemo(() => {
        if (status === 'success') return 'success';
        if (selectedIdea) return 'generate';
        return 'ideas';
    }, [status, selectedIdea]);

    const generateIdeas = async () => {
        const { selectedProvider, apiKeys, openRouterModel } = globalState;
        const model = selectedProvider === 'openrouter' ? openRouterModel : AI_PROVIDERS[selectedProvider].defaultModel;
        dispatch({ type: 'GET_IDEAS_START' });
        try {
            const ideas = await aiService.generateToolIdeas(apiKeys[selectedProvider], selectedProvider, post, model);
            dispatch({ type: 'GET_IDEAS_SUCCESS', payload: ideas });
        } catch (e: any) {
            dispatch({ type: 'GET_IDEAS_FAILURE', payload: e.message || 'Failed to generate ideas.' });
        }
    };

    const generateSnippet = async () => {
        if (!selectedIdea) return;
        const { selectedProvider, apiKeys, openRouterModel } = globalState;
        const model = selectedProvider === 'openrouter' ? openRouterModel : AI_PROVIDERS[selectedProvider].defaultModel;
        dispatch({ type: 'GENERATE_SNIPPET_START' });
        try {
            const stream = await aiService.generateSnippet(apiKeys[selectedProvider], selectedProvider, post, selectedIdea, model);
            for await (const chunk of stream) {
                dispatch({ type: 'GENERATE_SNIPPET_STREAM', payload: chunk });
            }
            dispatch({ type: 'GENERATE_SNIPPET_END' });
        } catch (e: any) {
            dispatch({ type: 'GENERATE_SNIPPET_FAILURE', payload: e.message || 'Failed to generate snippet.' });
        }
    };
    
    const handleInsert = async () => {
        if (!selectedIdea) return;
        dispatch({ type: 'INSERT_SNIPPET_START' });
        try {
            const cleanCode = editedSnippet.replace(/```html/gi, '').replace(/```/g, '');
            await insertSnippet(post, cleanCode, selectedIdea);
            dispatch({ type: 'INSERT_SNIPPET_SUCCESS' });
        } catch (e: any) {
            dispatch({ type: 'INSERT_SNIPPET_FAILURE', payload: e.message || 'Failed to insert snippet.' });
        }
    };

    useEffect(() => {
        generateIdeas();
    }, [post.id]);

    useEffect(() => {
        if (selectedIdea) {
            generateSnippet();
        }
    }, [selectedIdea]);

    useEffect(() => {
        if (isGeneratingIdeas) {
            const intervalId = setInterval(() => {
                setLoadingMessage(prev => loadingMessages[(loadingMessages.indexOf(prev) + 1) % loadingMessages.length]);
            }, 2500);
            return () => clearInterval(intervalId);
        }
    }, [isGeneratingIdeas]);

    useEffect(() => {
        if (isStreaming && !editedSnippet) setActiveTab('code'); 
    }, [isStreaming]);

    useEffect(() => {
        if (debouncedSnippet) {
            let raw = debouncedSnippet;
            raw = raw.replace(/```html/gi, '').replace(/```/g, '');

            let themeStyles = '';
            const hsl = hexToHsl(themeColor);
            if (hsl) {
                const baseHsl = `${hsl.h} ${hsl.s}% ${hsl.l}%`;
                const hoverHsl = `${hsl.h} ${hsl.s}% ${Math.max(0, hsl.l - 8)}%`;
                // Map to common variable names the AI might use
                themeStyles = `
                    :root {
                        --accent-color: hsl(${baseHsl}) !important;
                        --primary: hsl(${baseHsl}) !important;
                        --primary-color: hsl(${baseHsl}) !important;
                        --accent-color-hover: hsl(${hoverHsl}) !important;
                        --hover: hsl(${hoverHsl}) !important;
                    }
                `;
            }

            const bgColor = globalState.theme === 'dark' ? '#0f172a' : '#ffffff';
            const textColor = globalState.theme === 'dark' ? '#f1f5f9' : '#1e293b';

            const overrides = `
                <style id="sota-preview-overrides">
                    ${themeStyles}
                    ::-webkit-scrollbar { width: 8px; }
                    ::-webkit-scrollbar-track { background: transparent; }
                    ::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 4px; }
                    .dark ::-webkit-scrollbar-thumb { background: #475569; }
                    
                    html, body { 
                        background-color: ${bgColor} !important; 
                        color: ${textColor};
                        min-height: 100vh;
                        margin: 0;
                        padding: 0;
                        transition: background-color 0.3s, color 0.3s;
                        font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
                    }
                    body { box-sizing: border-box; }
                </style>
            `;

            let finalHtml = '';
            const hasDoctype = /<!DOCTYPE html>/i.test(raw);
            const hasHead = /<head[^>]*>/i.test(raw);
            const hasBody = /<body[^>]*>/i.test(raw);
            
            if (hasDoctype || hasHead || hasBody) {
                finalHtml = raw;
                if (globalState.theme === 'dark') {
                    if (/<html[^>]*class=["']/.test(finalHtml)) {
                        finalHtml = finalHtml.replace(/(<html[^>]*class=["'])/i, '$1dark ');
                    } else if (/<html/i.test(finalHtml)) {
                        finalHtml = finalHtml.replace(/<html/i, '<html class="dark"');
                    } else {
                        finalHtml = `<html class="dark">${finalHtml}</html>`;
                    }
                }
                if (/<\/head>/i.test(finalHtml)) {
                    finalHtml = finalHtml.replace(/<\/head>/i, `${overrides}</head>`);
                } else if (/<body/i.test(finalHtml)) {
                    finalHtml = finalHtml.replace(/<body([^>]*)>/i, `<body$1>${overrides}`);
                } else {
                    finalHtml = overrides + finalHtml;
                }
            } else {
                finalHtml = `
                    <!DOCTYPE html>
                    <html class="${globalState.theme}">
                    <head>
                        <meta charset="UTF-8">
                        <meta name="viewport" content="width=device-width, initial-scale=1.0">
                        ${overrides}
                        <style>body { padding: 1.5rem; }</style>
                    </head>
                    <body>${raw}</body>
                    </html>
                `;
            }
            
            setIframeSrcDoc(finalHtml);
        }
    }, [debouncedSnippet, themeColor, globalState.theme]);
    
    const TabButton: React.FC<{label: string; isActive: boolean; onClick: () => void; icon: React.ReactNode; disabled?: boolean;}> = ({ label, isActive, onClick, icon, disabled }) => (
        <button type="button" onClick={onClick} disabled={disabled} className={`flex items-center gap-2 px-3 py-2 sm:px-4 text-sm font-semibold rounded-t-md transition-colors border-b-2 ${ isActive ? 'text-blue-600 dark:text-blue-400 border-blue-600 dark:border-blue-400' : 'text-slate-500 dark:text-slate-400 border-transparent hover:text-slate-800 dark:hover:text-slate-200 hover:bg-slate-200/50 dark:hover:bg-slate-700/50' } disabled:opacity-50 disabled:cursor-not-allowed`} aria-selected={isActive}>
            {icon} {label}
        </button>
    );

    const renderIdeasStage = () => (
        <>
            <h2 className="text-xl sm:text-2xl font-bold mb-4 text-slate-800 dark:text-slate-100">1. Choose a "Linkable Asset" Idea</h2>
            <p className="text-slate-600 dark:text-slate-400 mb-6">Select the tool with the highest potential to answer user questions and keep them on your page.</p>
            {isGeneratingIdeas ? (
                 <div className="text-center">
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
                        <SkeletonIdeaCard/>
                        <SkeletonIdeaCard/>
                        <SkeletonIdeaCard/>
                    </div>
                    <p className="mt-4 text-sm text-slate-500 dark:text-slate-400 animate-pulse">{loadingMessage}</p>
                </div>
            ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
                    {toolIdeas.map((idea, index) => (
                        <IdeaCard key={index} idea={idea} onSelect={() => dispatch({type: 'SELECT_IDEA', payload: idea})} isSelected={selectedIdea?.title === idea.title}/>
                    ))}
                </div>
            )}
        </>
    );

    const renderGenerateStage = () => (
         <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 sm:gap-8 h-full">
            <div className="lg:col-span-1 flex flex-col gap-4 sm:gap-6">
                <div>
                    <h3 className="text-xl font-bold mb-2">2. Customize &amp; Insert</h3>
                    <p className="text-slate-600 dark:text-slate-400 mb-4">Fine-tune the appearance and code, then insert it into your post with one click.</p>
                </div>
                
                <Card className="p-4">
                    <label htmlFor="theme-color" className="block text-sm font-medium text-slate-700 dark:text-slate-300">Accent Color</label>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mb-2">Live preview updates instantly.</p>
                    <div className="mt-2 flex items-center gap-3 p-2 bg-slate-100 dark:bg-slate-900/50 rounded-md">
                        <input id="theme-color" type="color" value={themeColor} onChange={(e) => setThemeColor(e.target.value)} className="w-10 h-10 p-0 border-none bg-transparent rounded cursor-pointer" aria-label="Select accent color" disabled={isLoading && !isStreaming} />
                        <span className="font-mono text-sm text-slate-500">{themeColor}</span>
                    </div>
                </Card>

                <div className="space-y-3 mt-auto">
                     <Button onClick={handleInsert} disabled={isLoading || !editedSnippet} className="w-full" size="large">
                        {isInserting ? <><Spinner /> Inserting...</> : 'Insert into Post'}
                     </Button>
                     <Button onClick={generateSnippet} className="w-full" variant="secondary" disabled={isLoading}>Regenerate Tool</Button>
                </div>
            </div>

            <div className="lg:col-span-2 flex flex-col min-h-[500px] h-full">
                <div className="flex items-center border-b border-slate-200 dark:border-slate-700">
                  <TabButton label="Code" isActive={activeTab === 'code'} onClick={() => setActiveTab('code')} icon={<CodeBracketIcon className="w-5 h-5"/>} />
                  <TabButton label="Live Preview" isActive={activeTab === 'preview'} onClick={() => setActiveTab('preview')} icon={<EyeIcon className="w-5 h-5"/>} />
                </div>
                <div className="flex-grow bg-slate-100 dark:bg-slate-900/50 rounded-b-lg p-1 border border-t-0 border-slate-200 dark:border-slate-700 relative min-h-[450px]">
                    {activeTab === 'code' ? (
                        <textarea
                            value={editedSnippet}
                            onChange={(e) => dispatch({ type: 'EDIT_SNIPPET', payload: e.target.value })}
                            className="w-full h-full p-4 bg-slate-900 dark:bg-black/50 text-sm text-slate-100 whitespace-pre break-words font-mono resize-none border-0 rounded-md focus:ring-2 focus:ring-blue-500"
                            placeholder={isStreaming ? "AI is generating code..." : "Loading code..."}
                            disabled={isStreaming}
                            aria-label="HTML Snippet Code Editor"
                        />
                    ) : (
                        <iframe 
                            key={iframeSrcDoc} // Force re-render on content change
                            srcDoc={iframeSrcDoc} 
                            title="Generated Snippet Preview" 
                            className="w-full h-full border-0 rounded-md shadow-inner bg-transparent" 
                            sandbox="allow-scripts allow-forms allow-modals"
                        />
                    )}
                     {isStreaming && (
                        <div className="absolute bottom-4 right-4 flex items-center gap-2 text-xs text-blue-500 bg-white/90 dark:bg-slate-800/90 px-3 py-1.5 rounded-full shadow-lg backdrop-blur-sm border border-blue-200 dark:border-blue-900">
                            <Spinner />
                            <span>AI is coding...</span>
                        </div>
                    )}
                </div>
            </div>
          </div>
    );

    const renderSuccessStage = () => (
         <div className="text-center bg-green-50 dark:bg-green-900/50 rounded-xl animate-fade-in flex flex-col items-center justify-center p-8 min-h-[400px]">
            <div className="w-16 h-16 mx-auto bg-green-100 dark:bg-green-900 rounded-full flex items-center justify-center">
                <CheckIcon className="w-10 h-10 text-green-600 dark:text-green-400" />
            </div>
            <h3 className="mt-4 text-2xl font-bold text-green-800 dark:text-green-300">Snippet Inserted Successfully!</h3>
            <p className="mt-2 text-slate-600 dark:text-slate-400 max-w-md">
              Your post <a href={post.link} target="_blank" rel="noopener noreferrer" className="text-blue-600 dark:text-blue-400 hover:underline font-semibold"  dangerouslySetInnerHTML={{ __html: `"${post.title.rendered}"` }}/> has been updated.
            </p>
            <Button onClick={onClose} className="mt-6">Finish</Button>
          </div>
    );
    
    return (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-40 flex items-center justify-center p-4 animate-fade-in" aria-labelledby="modal-title" role="dialog" aria-modal="true" onClick={onClose}>
            <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl w-full max-w-7xl p-6 sm:p-8 border border-slate-200 dark:border-slate-700 transform transition-all max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
                <header className="flex-shrink-0 flex justify-between items-start mb-4">
                    <div>
                        <h2 id="modal-title" className="text-lg sm:text-xl font-bold text-slate-900 dark:text-slate-100" dangerouslySetInnerHTML={{__html: `Tool for: "${post.title.rendered}"`}}/>
                        {selectedIdea && <p className="text-sm text-slate-500 dark:text-slate-400">Selected Idea: "{selectedIdea.title}"</p>}
                    </div>
                    <button onClick={onClose} className="p-1 rounded-full text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700 hover:text-slate-600 dark:hover:text-slate-200 transition-colors">
                        <XCircleIcon className="w-8 h-8"/>
                    </button>
                </header>

                <div className="flex-grow overflow-y-auto pr-2 -mr-2 min-h-[60vh]">
                    {currentStage === 'ideas' && renderIdeasStage()}
                    {currentStage === 'generate' && renderGenerateStage()}
                    {currentStage === 'success' && renderSuccessStage()}

                    {error && (
                        <div className="mt-4 bg-red-100 dark:bg-red-900/50 border border-red-400 dark:border-red-600 text-red-700 dark:text-red-300 px-4 py-3 rounded-md text-sm" role="alert">
                            <strong className="font-bold">An Error Occurred: </strong>
                            <span className="block sm:inline">{error}</span>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export const ToolGenerationModal = React.memo(ToolGenerationModalComponent);

export default ToolGenerationModal;