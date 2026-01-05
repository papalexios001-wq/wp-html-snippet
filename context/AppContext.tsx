import React, { createContext, useContext, useReducer, useEffect, ReactNode, Dispatch } from 'react';
import { 
    AppState, AiProvider, WordPressConfig, WordPressPost, ToolIdea, 
    ApiKeys, Theme 
} from '../types';
import * as wordpressService from '../services/wordpressService';
import * as aiService from '../services/aiService';
import * as opportunityScoreCache from '../services/opportunityScoreCache'; // SOTA: Import the new cache service.
import { AI_PROVIDERS, SHORTCODE_REMOVAL_REGEX } from '../constants';

// --- ACTION TYPES ---
type Action =
  | { type: 'INITIALIZE_STATE'; payload: Partial<AppState> }
  | { type: 'SET_THEME'; payload: Theme }
  | { type: 'SET_PROVIDER'; payload: AiProvider }
  | { type: 'SET_API_KEY'; payload: { provider: AiProvider; key: string } }
  | { type: 'SET_OPENROUTER_MODEL'; payload: string }
  | { type: 'VALIDATE_API_KEY_START'; payload: AiProvider }
  | { type: 'VALIDATE_API_KEY_SUCCESS'; payload: AiProvider }
  | { type: 'VALIDATE_API_KEY_FAILURE'; payload: { provider: AiProvider } }
  | { type: 'CONNECT_START' }
  | { type: 'CONNECT_SUCCESS'; payload: { config: WordPressConfig; posts: WordPressPost[], totalPages: number } }
  | { type: 'CONNECT_FAILURE'; payload: string }
  | { type: 'SETUP_REQUIRED'; payload: WordPressConfig }
  | { type: 'RESET' }
  | { type: 'SET_POST_SEARCH_QUERY'; payload: string }
  | { type: 'SET_POST_SORT_ORDER'; payload: 'opportunity' | 'date' }
  | { type: 'DELETE_SNIPPET_START'; payload: number }
  | { type: 'DELETE_SNIPPET_SUCCESS'; payload: WordPressPost }
  | { type: 'DELETE_SNIPPET_FAILURE'; payload: { postId: number, error: string } }
  | { type: 'SCORE_POSTS_START'; payload: { postIds: number[] } }
  | { type: 'SCORE_POSTS_PROGRESS_UPDATE'; payload: Partial<WordPressPost>[] } // SOTA: New action for real-time score updates.
  | { type: 'SCORE_POSTS_SUCCESS' } // Payload no longer needed
  | { type: 'SCORE_POSTS_FAILURE'; payload: string }
  | { type: 'INSERT_SNIPPET_SUCCESS'; payload: WordPressPost }
  | { type: 'FETCH_MORE_POSTS_START' }
  | { type: 'FETCH_MORE_POSTS_SUCCESS'; payload: { posts: WordPressPost[]; page: number; totalPages: number } }
  | { type: 'FETCH_MORE_POSTS_FAILURE'; payload: string }
  | { type: 'REFRESH_TOOL_START'; payload: number }
  | { type: 'REFRESH_TOOL_SUCCESS'; payload: { postId: number; toolCreationDate: number } }
  | { type: 'REFRESH_TOOL_FAILURE'; payload: { postId: number; error: string } };

// --- CONTEXT and PROVIDER ---
interface AppContextType {
  state: AppState;
  dispatch: Dispatch<Action>;
  setTheme: (theme: Theme) => void;
  setProvider: (provider: AiProvider) => void;
  setApiKey: (provider: AiProvider, key: string) => void;
  setOpenRouterModel: (model: string) => void;
  validateAndSaveApiKey: (provider: AiProvider) => Promise<void>;
  connectToWordPress: (config: WordPressConfig) => Promise<void>;
  retryConnection: () => void;
  reset: () => void;
  setPostSearchQuery: (query: string) => void;
  setPostSortOrder: (order: 'opportunity' | 'date') => void;
  deleteSnippet: (postId: number, toolId?: number) => Promise<void>;
  runOpportunityAnalysis: () => Promise<void>;
  insertSnippet: (post: WordPressPost, snippet: string, idea: ToolIdea) => Promise<void>;
  fetchMorePosts: () => Promise<void>;
  refreshTool: (postId: number, toolId: number) => Promise<void>;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

const filterAndSortPosts = (posts: WordPressPost[], query: string, sort: 'opportunity' | 'date'): WordPressPost[] => {
    let filtered = posts;
    if (query) {
        filtered = posts.filter(p => p.title.rendered.toLowerCase().includes(query.toLowerCase()));
    }
    
    const sorted = [...filtered];

    if (sort === 'opportunity') {
        sorted.sort((a, b) => (b.opportunityScore ?? -1) - (a.opportunityScore ?? -1));
    } else {
        // Default WP API order is reverse chronological (newest first), so no sort needed for 'date'
    }
    return sorted;
};

// --- INITIAL STATE ---
const initialState: AppState = {
    status: 'idle',
    error: null,
    deletingPostId: null,
    refreshingPostId: null,
    theme: 'light',
    frameStatus: 'initializing',
    isScoring: false,
    scoringPostIds: [],
    isFetchingMorePosts: false,
    apiKeys: { [AiProvider.Gemini]: '', [AiProvider.OpenAI]: '', [AiProvider.Anthropic]: '', [AiProvider.OpenRouter]: '' },
    apiValidationStatuses: { [AiProvider.Gemini]: 'idle', [AiProvider.OpenAI]: 'idle', [AiProvider.Anthropic]: 'idle', [AiProvider.OpenRouter]: 'idle' },
    apiValidationErrorMessages: { [AiProvider.Gemini]: null, [AiProvider.OpenAI]: null, [AiProvider.Anthropic]: null, [AiProvider.OpenRouter]: null },
    selectedProvider: AiProvider.Gemini,
    openRouterModel: AI_PROVIDERS[AiProvider.OpenRouter].defaultModel,
    wpConfig: null,
    posts: [],
    filteredPosts: [],
    postsPage: 1,
    hasMorePosts: false,
    postSearchQuery: '',
    postSortOrder: 'date',
    setupRequired: false,
};

// --- REDUCER ---
const appReducer = (state: AppState, action: Action): AppState => {
  switch (action.type) {
    case 'INITIALIZE_STATE':
        return { ...state, ...action.payload };
    case 'SET_THEME':
        return { ...state, theme: action.payload };
    case 'SET_PROVIDER':
        return { ...state, selectedProvider: action.payload };
    case 'SET_API_KEY':
        const newKeys = { ...state.apiKeys, [action.payload.provider]: action.payload.key };
        const newStatuses = { ...state.apiValidationStatuses, [action.payload.provider]: 'idle' as const };
        return { ...state, apiKeys: newKeys, apiValidationStatuses: newStatuses };
    case 'SET_OPENROUTER_MODEL':
        return { ...state, openRouterModel: action.payload };
    case 'VALIDATE_API_KEY_START':
        return { ...state, apiValidationStatuses: { ...state.apiValidationStatuses, [action.payload]: 'validating' } };
    case 'VALIDATE_API_KEY_SUCCESS':
        return { ...state, apiValidationStatuses: { ...state.apiValidationStatuses, [action.payload]: 'valid' } };
    case 'VALIDATE_API_KEY_FAILURE':
        return { ...state, apiValidationStatuses: { ...state.apiValidationStatuses, [action.payload.provider]: 'invalid' } };
    case 'CONNECT_START':
        return { ...state, status: 'loading', error: null, setupRequired: false };
    case 'CONNECT_SUCCESS':
        const initialPosts = action.payload.posts; // SOTA: Get scores from cache after connecting
        const cachedScores = opportunityScoreCache.getScores();
        const hydratedPosts = initialPosts.map(post => {
            const cached = cachedScores[post.id];
            if (cached) {
                return { ...post, opportunityScore: cached.opportunityScore, opportunityRationale: cached.opportunityRationale };
            }
            return post;
        });
        const initialFilteredPosts = filterAndSortPosts(hydratedPosts, state.postSearchQuery, state.postSortOrder);
        return { ...state, status: 'success', wpConfig: action.payload.config, posts: hydratedPosts, filteredPosts: initialFilteredPosts, postsPage: 1, hasMorePosts: 1 < action.payload.totalPages };
    case 'CONNECT_FAILURE':
        return { ...state, status: 'error', error: action.payload };
    case 'SETUP_REQUIRED':
        return { ...state, status: 'idle', error: null, setupRequired: true, wpConfig: action.payload };
    case 'RESET':
        return { ...initialState, apiKeys: state.apiKeys, theme: state.theme }; // Keep theme and keys on reset
    case 'SET_POST_SEARCH_QUERY':
        const filteredByQuery = filterAndSortPosts(state.posts, action.payload, state.postSortOrder);
        return { ...state, postSearchQuery: action.payload, filteredPosts: filteredByQuery };
    case 'SET_POST_SORT_ORDER':
        const sorted = filterAndSortPosts(state.posts, state.postSearchQuery, action.payload);
        return { ...state, postSortOrder: action.payload, filteredPosts: sorted };
    case 'DELETE_SNIPPET_START':
        return { ...state, deletingPostId: action.payload };
    case 'DELETE_SNIPPET_SUCCESS':
        const postsAfterDelete = state.posts.map(p => p.id === action.payload.id ? action.payload : p);
        return { 
            ...state, 
            deletingPostId: null,
            posts: postsAfterDelete,
            filteredPosts: filterAndSortPosts(postsAfterDelete, state.postSearchQuery, state.postSortOrder)
        };
    case 'DELETE_SNIPPET_FAILURE':
        console.error(`Failed to delete snippet for post ${action.payload.postId}: ${action.payload.error}`);
        return { ...state, deletingPostId: null };
    case 'SCORE_POSTS_START':
        return { ...state, isScoring: true, error: null, scoringPostIds: action.payload.postIds };
    case 'SCORE_POSTS_PROGRESS_UPDATE':
        // SOTA: Incrementally update scores as they arrive from the API.
        const updatedPosts = state.posts.map(post => {
            const scoreData = action.payload.find(s => s.id === post.id);
            return scoreData ? { ...post, ...scoreData } : post;
        });
        const updatedScoringIds = state.scoringPostIds.filter(id => !action.payload.some(s => s.id === id));
        return {
            ...state,
            posts: updatedPosts,
            filteredPosts: filterAndSortPosts(updatedPosts, state.postSearchQuery, state.postSortOrder),
            scoringPostIds: updatedScoringIds,
        };
    case 'SCORE_POSTS_SUCCESS':
        return { 
            ...state, 
            isScoring: false,
            scoringPostIds: [],
            postSortOrder: 'opportunity', // Switch to opportunity sort after scoring
            filteredPosts: filterAndSortPosts(state.posts, state.postSearchQuery, 'opportunity'),
        };
    case 'SCORE_POSTS_FAILURE':
        return { ...state, isScoring: false, scoringPostIds: [], error: action.payload };
    case 'INSERT_SNIPPET_SUCCESS':
         const postsAfterInsert = state.posts.map(p => p.id === action.payload.id ? action.payload : p);
        return { 
            ...state, 
            posts: postsAfterInsert,
            filteredPosts: filterAndSortPosts(postsAfterInsert, state.postSearchQuery, state.postSortOrder)
        };
    case 'FETCH_MORE_POSTS_START':
        return { ...state, isFetchingMorePosts: true };
    case 'FETCH_MORE_POSTS_SUCCESS':
        const newPosts = [...state.posts, ...action.payload.posts];
        return { ...state, isFetchingMorePosts: false, posts: newPosts, filteredPosts: filterAndSortPosts(newPosts, state.postSearchQuery, state.postSortOrder), postsPage: action.payload.page, hasMorePosts: action.payload.page < action.payload.totalPages };
    case 'FETCH_MORE_POSTS_FAILURE':
        return { ...state, isFetchingMorePosts: false, error: action.payload };
    case 'REFRESH_TOOL_START':
        return { ...state, refreshingPostId: action.payload };
    case 'REFRESH_TOOL_SUCCESS':
        const postsAfterRefresh = state.posts.map(p => p.id === action.payload.postId ? { ...p, toolCreationDate: action.payload.toolCreationDate } : p);
        return { 
            ...state, 
            refreshingPostId: null,
            posts: postsAfterRefresh,
            filteredPosts: filterAndSortPosts(postsAfterRefresh, state.postSearchQuery, state.postSortOrder)
        };
    case 'REFRESH_TOOL_FAILURE':
        console.error(`Failed to refresh snippet for post ${action.payload.postId}: ${action.payload.error}`);
        return { ...state, refreshingPostId: null, error: `Failed to refresh tool for post ${action.payload.postId}.` };
    default:
      return state;
  }
};

// --- PROVIDER COMPONENT ---
export const AppContextProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const [state, dispatch] = useReducer(appReducer, initialState);

    useEffect(() => {
        // Load persisted state from localStorage
        const persistedState: Partial<AppState> = {};
        const storedKeys = localStorage.getItem('apiKeys');
        const storedConfig = localStorage.getItem('wpConfig');
        const storedTheme = localStorage.getItem('theme') as Theme;

        if (storedKeys) persistedState.apiKeys = JSON.parse(storedKeys);
        if (storedConfig) persistedState.wpConfig = JSON.parse(storedConfig);
        if (storedTheme) persistedState.theme = storedTheme;
        else if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
            persistedState.theme = 'dark';
        }
        dispatch({ type: 'INITIALIZE_STATE', payload: persistedState });
    }, []);

    useEffect(() => {
        // Persist theme
        if (state.theme === 'dark') {
            document.documentElement.classList.add('dark');
            document.documentElement.classList.remove('light');
        } else {
            document.documentElement.classList.remove('dark');
            document.documentElement.classList.add('light');
        }
        localStorage.setItem('theme', state.theme);
    }, [state.theme]);
    
    const setTheme = (theme: Theme) => dispatch({ type: 'SET_THEME', payload: theme });
    const setProvider = (provider: AiProvider) => dispatch({ type: 'SET_PROVIDER', payload: provider });
    const setApiKey = (provider: AiProvider, key: string) => dispatch({ type: 'SET_API_KEY', payload: { provider, key } });
    const setOpenRouterModel = (model: string) => dispatch({ type: 'SET_OPENROUTER_MODEL', payload: model });
    const setPostSearchQuery = (query: string) => dispatch({ type: 'SET_POST_SEARCH_QUERY', payload: query });
    const setPostSortOrder = (order: 'opportunity' | 'date') => dispatch({ type: 'SET_POST_SORT_ORDER', payload: order });

    const validateAndSaveApiKey = async (provider: AiProvider) => {
        dispatch({ type: 'VALIDATE_API_KEY_START', payload: provider });
        const key = state.apiKeys[provider];
        const model = provider === AiProvider.OpenRouter ? state.openRouterModel : AI_PROVIDERS[provider].defaultModel;

        const isValid = await aiService.validateApiKey(provider, key, model);

        if (isValid) {
            localStorage.setItem('apiKeys', JSON.stringify(state.apiKeys));
            dispatch({ type: 'VALIDATE_API_KEY_SUCCESS', payload: provider });
        } else {
            dispatch({ type: 'VALIDATE_API_KEY_FAILURE', payload: { provider } });
        }
    };
    
    const connectToWordPress = async (config: WordPressConfig) => {
        dispatch({ type: 'CONNECT_START' });
        try {
            const isSetup = await wordpressService.checkSetup(config);
            if (!isSetup) {
                dispatch({ type: 'SETUP_REQUIRED', payload: config });
                return;
            }
            const { posts, totalPages } = await wordpressService.fetchPosts(config, 1);
            localStorage.setItem('wpConfig', JSON.stringify(config));
            dispatch({ type: 'CONNECT_SUCCESS', payload: { config, posts, totalPages } });
        } catch (error: any) {
            dispatch({ type: 'CONNECT_FAILURE', payload: error.message || 'An unknown error occurred.' });
        }
    };

    const fetchMorePosts = async () => {
        if (!state.wpConfig || state.isFetchingMorePosts || !state.hasMorePosts) return;
        dispatch({ type: 'FETCH_MORE_POSTS_START' });
        try {
            const nextPage = state.postsPage + 1;
            const { posts, totalPages } = await wordpressService.fetchPosts(state.wpConfig, nextPage);
            dispatch({ type: 'FETCH_MORE_POSTS_SUCCESS', payload: { posts, page: nextPage, totalPages } });
        } catch (error: any) {
            dispatch({ type: 'FETCH_MORE_POSTS_FAILURE', payload: error.message || 'Failed to fetch more posts.' });
        }
    };

    const retryConnection = () => {
        if (state.wpConfig) {
            connectToWordPress(state.wpConfig);
        }
    };

    const reset = () => {
        localStorage.removeItem('wpConfig');
        dispatch({ type: 'RESET' });
    };

    const deleteSnippet = async (postId: number, toolId?: number) => {
        if (!state.wpConfig) return;
        dispatch({ type: 'DELETE_SNIPPET_START', payload: postId });
        try {
            if (toolId) {
                await wordpressService.deleteCfTool(state.wpConfig, toolId);
            }
            const post = state.posts.find(p => p.id === postId);
            if (!post) throw new Error("Post not found");
            const newContent = post.content.rendered.replace(SHORTCODE_REMOVAL_REGEX, '');
            const updatedPost = await wordpressService.updatePost(state.wpConfig, postId, newContent);
            const freshPostDetails: WordPressPost = { ...post, ...updatedPost, hasOptimizerSnippet: false, toolId: undefined, opportunityScore: undefined, toolCreationDate: undefined, opportunityRationale: undefined };
            dispatch({ type: 'DELETE_SNIPPET_SUCCESS', payload: freshPostDetails });
        } catch (error: any) {
            dispatch({ type: 'DELETE_SNIPPET_FAILURE', payload: { postId, error: error.message } });
        }
    };
    
    const runOpportunityAnalysis = async () => {
        const { selectedProvider, apiKeys, posts, openRouterModel } = state;
        const apiKey = apiKeys[selectedProvider];
        const model = selectedProvider === AiProvider.OpenRouter ? openRouterModel : AI_PROVIDERS[selectedProvider].defaultModel;
    
        if (!apiKey || posts.length === 0) return;
    
        // SOTA: Only analyze posts that don't have a fresh score in the cache.
        const cachedScores = opportunityScoreCache.getScores();
        const postsToScore = posts.filter(p => cachedScores[p.id] === undefined);
    
        if (postsToScore.length === 0) {
            // All posts are scored and cached. Simply re-sort to ensure view is correct.
            dispatch({ type: 'SET_POST_SORT_ORDER', payload: 'opportunity' });
            return;
        }
        
        dispatch({ type: 'SCORE_POSTS_START', payload: { postIds: postsToScore.map(p => p.id) } });
        
        try {
            // SOTA: onProgress callback dispatches incremental updates and saves to cache.
            const onProgress = (scoredBatch: Partial<WordPressPost>[]) => {
                opportunityScoreCache.addScores(scoredBatch);
                dispatch({ type: 'SCORE_POSTS_PROGRESS_UPDATE', payload: scoredBatch });
            };
    
            await aiService.getOpportunityScores(apiKey, selectedProvider, postsToScore, model, onProgress);
            
            dispatch({ type: 'SCORE_POSTS_SUCCESS' });
        } catch (error: any) {
            dispatch({ type: 'SCORE_POSTS_FAILURE', payload: error.message || 'An error occurred during scoring.' });
        }
    };

    const insertSnippet = async (post: WordPressPost, snippet: string, idea: ToolIdea) => {
        const { wpConfig } = state;
        if (!wpConfig || !post || !snippet || !idea) {
            throw new Error("Missing required data to insert snippet.");
        }
       
        const tool = await wordpressService.createCfTool(wpConfig, idea.title, snippet);
        const shortcode = `[contentforge_tool id="${tool.id}"]`;
        const content = post.content.rendered;
        
        // Intelligent insertion: after the first H2, or at the start.
        const h2Match = /<\/h2>/i.exec(content);
        let newContent = '';
        if (h2Match) {
            const insertIndex = h2Match.index + 5; // after the </h2> tag
            newContent = content.slice(0, insertIndex) + `<p>${shortcode}</p>` + content.slice(insertIndex);
        } else {
            newContent = `<p>${shortcode}</p>` + content;
        }
        
        const updatedPost = await wordpressService.updatePost(wpConfig, post.id, newContent);
        
        const finalPost: WordPressPost = {
            ...post,
            ...updatedPost,
            hasOptimizerSnippet: true,
            toolId: tool.id,
            toolCreationDate: Date.now()
        };

        dispatch({ type: 'INSERT_SNIPPET_SUCCESS', payload: finalPost });
    };

    const refreshTool = async (postId: number, toolId: number) => {
        const { wpConfig, selectedProvider, apiKeys, posts, openRouterModel } = state;
        const post = posts.find(p => p.id === postId);
        if (!wpConfig || !post) return;
        
        dispatch({ type: 'REFRESH_TOOL_START', payload: postId });
        try {
            const oldTool = await wordpressService.fetchCfTool(wpConfig, toolId);
            const apiKey = apiKeys[selectedProvider];
            const model = selectedProvider === AiProvider.OpenRouter ? openRouterModel : AI_PROVIDERS[selectedProvider].defaultModel;
            
            const stream = await aiService.refreshSnippet(apiKey, selectedProvider, post, oldTool.content.rendered, model);
            
            let newSnippet = '';
            for await (const chunk of stream) {
                newSnippet += chunk;
            }

            if (newSnippet) {
                await wordpressService.updateCfTool(wpConfig, toolId, oldTool.title.rendered, newSnippet);
                dispatch({ type: 'REFRESH_TOOL_SUCCESS', payload: { postId, toolCreationDate: Date.now() } });
            } else {
                throw new Error("AI failed to generate a refreshed snippet.");
            }

        } catch (error: any) {
            dispatch({ type: 'REFRESH_TOOL_FAILURE', payload: { postId, error: error.message } });
        }
    };

    const value = {
        state,
        dispatch,
        setTheme,
        setProvider,
        setApiKey,
        setOpenRouterModel,
        validateAndSaveApiKey,
        connectToWordPress,
        retryConnection,
        reset,
        setPostSearchQuery,
        setPostSortOrder,
        deleteSnippet,
        runOpportunityAnalysis,
        insertSnippet,
        fetchMorePosts,
        refreshTool,
    };

    return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
};

// --- HOOK ---
export const useAppContext = (): AppContextType => {
  const context = useContext(AppContext);
  if (context === undefined) {
    throw new Error('useAppContext must be used within an AppContextProvider');
  }
  return context;
};
