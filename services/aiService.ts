import { GoogleGenAI, Type } from '@google/genai';
import { AiProvider, WordPressPost, ToolIdea } from '../types';

/**
 * A robust, multi-stage parser to handle various JSON response formats from different LLMs.
 * @param text The raw text response from the AI model.
 * @returns The parsed JSON object or array.
 * @throws An error if the JSON cannot be parsed.
 */
function parseJsonResponse<T>(text: string): T {
    try {
        // Stage 0: Clean common markdown artifacts immediately
        let cleaned = text.replace(/```json/g, '').replace(/```/g, '').trim();
        
        // Stage 1: Attempt to parse the cleaned text directly.
        return JSON.parse(cleaned) as T;
    } catch (directParseError) {
        // Stage 2: If direct parsing fails, try to extract a JSON object/array via Regex.
        // This handles cases where the model adds conversational text before or after.
        const jsonMatch = text.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
        if (jsonMatch && jsonMatch[0]) {
            try {
                return JSON.parse(jsonMatch[0]) as T;
            } catch (substringParseError) {
                 throw new Error(`Failed to parse JSON. Extracted structure invalid: ${substringParseError}`);
            }
        }

        throw new Error(`Failed to parse JSON response. Raw text: "${text.substring(0, 100)}..."`);
    }
}

// Helper: Autonomous Retry Logic with Exponential Backoff
async function withRetry<T>(fn: () => Promise<T>, retries = 3, delay = 1000): Promise<T> {
    try {
        return await fn();
    } catch (error: any) {
        if (retries === 0) throw error;
        
        // Don't retry on auth errors (401) or bad requests (400)
        if (error.status === 401 || error.status === 400 || error.message?.includes('API key')) throw error;
        
        console.warn(`API call failed, retrying in ${delay}ms... (${retries} left). Error: ${error.message}`);
        await new Promise(resolve => setTimeout(resolve, delay));
        return withRetry(fn, retries - 1, delay * 2);
    }
}

// Helper to initialize the Gemini client
const getGeminiClient = (apiKey: string): GoogleGenAI => {
    return new GoogleGenAI({ apiKey });
};

const getProviderConfig = (provider: AiProvider, apiKey: string) => {
    switch (provider) {
        case AiProvider.OpenAI:
            return {
                url: 'https://api.openai.com/v1/chat/completions',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` }
            };
        case AiProvider.Anthropic:
            return {
                url: 'https://api.anthropic.com/v1/messages',
                headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }
            };
        case AiProvider.OpenRouter:
            return {
                url: 'https://openrouter.ai/api/v1/chat/completions',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`,
                    'HTTP-Referer': 'https://html-snippet-ai.com',
                    'X-Title': 'HTML Snippet AI',
                }
            };
        default:
            throw new Error(`Unsupported provider config: ${provider}`);
    }
};

/**
 * Validates an API key by making a minimal call.
 */
export async function validateApiKey(provider: AiProvider, apiKey: string, model: string): Promise<boolean> {
    if (!apiKey) return false;
    try {
        return await withRetry(async () => {
            if (provider === AiProvider.Gemini) {
                const ai = getGeminiClient(apiKey);
                await ai.models.generateContent({
                    model: 'gemini-3-flash-preview',
                    contents: 'h', 
                    config: { maxOutputTokens: 1 }
                });
                return true;
            }
            
            const config = getProviderConfig(provider, apiKey);
            let body;
            const payload = { model: model, messages: [{ role: 'user', content: 'Hi' }], max_tokens: 1 };
            body = JSON.stringify(payload);

            const response = await fetch(config.url, { method: 'POST', headers: config.headers, body: body });
            return response.ok;
        });
    } catch (error) {
        console.error(`API key validation failed for ${provider}:`, error);
        return false;
    }
}

// SOTA Performance: Adaptive Batch Size & Concurrency
const SCORE_BATCH_SIZE = 8;
const MAX_CONCURRENT_REQUESTS = 6; 

/**
 * Analyzes posts using an adaptive parallel processing engine.
 */
export async function getOpportunityScores(
    apiKey: string,
    provider: AiProvider,
    posts: WordPressPost[],
    model: string,
    onProgress: (scoredPosts: Partial<WordPressPost>[]) => void
): Promise<void> {
    const postBatches: WordPressPost[][] = [];
    for (let i = 0; i < posts.length; i += SCORE_BATCH_SIZE) {
        postBatches.push(posts.slice(i, i + SCORE_BATCH_SIZE));
    }

    const processBatch = async (batch: WordPressPost[]) => {
        try {
            await withRetry(async () => {
                const postContext = batch.map(p => `{"id": ${p.id}, "title": "${p.title.rendered.replace(/"/g, '\\"').replace(/\n/g, ' ')}"}`).join(',\n');
                const prompt = `Analyze these blog posts for "Linkable Asset" potential (SEO/AEO).
                
Input:
[${postContext}]

Criteria:
- Score 90-100: High-intent "How-to", "Calculator", "Visualizer" topics. Excellent for interactive assets.
- Score 0-20: News, Updates, Personal Stories (Low utility).

Output JSON ONLY:
{ "posts": [ { "id": 123, "opportunityScore": 95, "opportunityRationale": "Perfect for ROI calculator." } ] }`;

                let batchScores: Partial<WordPressPost>[] = [];

                if (provider === AiProvider.Gemini) {
                    const ai = getGeminiClient(apiKey);
                    const response = await ai.models.generateContent({
                        model: 'gemini-3-flash-preview',
                        contents: prompt,
                        config: {
                            responseMimeType: "application/json",
                            responseSchema: {
                                type: Type.OBJECT,
                                properties: {
                                    posts: {
                                        type: Type.ARRAY,
                                        items: {
                                            type: Type.OBJECT,
                                            properties: {
                                                id: { type: Type.INTEGER },
                                                opportunityScore: { type: Type.INTEGER },
                                                opportunityRationale: { type: Type.STRING },
                                            },
                                            required: ["id", "opportunityScore", "opportunityRationale"],
                                        }
                                    }
                                }
                            }
                        }
                    });
                    // SOTA Fix: Use robust parser even for Gemini to handle edge cases
                    const parsed = parseJsonResponse<{posts: any[]}>(response.text);
                    batchScores = parsed.posts || [];
                } else {
                    const config = getProviderConfig(provider, apiKey);
                    const body = JSON.stringify({
                        model: model,
                        messages: [{ role: 'user', content: prompt }],
                        response_format: { type: 'json_object' }
                    });

                    const response = await fetch(config.url, { method: 'POST', headers: config.headers, body });
                    if (!response.ok) throw new Error(`API Error: ${response.status}`);
                    
                    const data = await response.json();
                    const rawContent = provider === AiProvider.Anthropic ? data.content[0].text : data.choices[0].message.content;
                    const parsedResult = parseJsonResponse<{posts: Partial<WordPressPost>[] }>(rawContent);
                    batchScores = parsedResult.posts || [];
                }
                
                onProgress(batchScores);
            });
        } catch (error) {
            console.error(`Batch failed after retries:`, error);
        }
    };

    const queue = [...postBatches];
    const activeWorkers = new Set<Promise<void>>();

    while (queue.length > 0 || activeWorkers.size > 0) {
        while (queue.length > 0 && activeWorkers.size < MAX_CONCURRENT_REQUESTS) {
            const batch = queue.shift()!;
            const worker = processBatch(batch).then(() => {
                activeWorkers.delete(worker);
            });
            activeWorkers.add(worker);
        }
        
        if (activeWorkers.size > 0) {
            await Promise.race(activeWorkers);
        } else {
            break;
        }
    }
}

/**
 * Generates tool ideas using high-context prompting.
 */
export async function generateToolIdeas(
    apiKey: string,
    provider: AiProvider,
    post: WordPressPost,
    model: string,
): Promise<ToolIdea[]> {
    const cleanContent = post.content.rendered.replace(/<[^>]*>?/gm, '').substring(0, 3000);
    
    return await withRetry(async () => {
        const prompt = `Act as a World-Class SEO & AEO (Answer Engine Optimization) Strategist. 
Analyze this content to find "Linkable Asset" opportunities that define the industry standard.

Title: "${post.title.rendered}"
Excerpt: "${cleanContent.substring(0, 500)}..."

Suggest 3 interactive tools that will:
1. Maximize Dwell Time (Time on Page).
2. Attract natural backlinks from high-DR sites.
3. Solve a complex "How to" or "How much" problem visually.

Output JSON:
{ "ideas": [ { "title": "Interactive Mortgage Visualizer", "description": "A dynamic chart showing principal vs interest over 30 years.", "icon": "chart" } ] }
Icons: "calculator", "chart", "list", "idea"`;
        
        if (provider === AiProvider.Gemini) {
            const ai = getGeminiClient(apiKey);
            const response = await ai.models.generateContent({
                model: 'gemini-3-flash-preview',
                contents: prompt,
                config: {
                    responseMimeType: "application/json",
                    responseSchema: {
                        type: Type.OBJECT,
                        properties: {
                            ideas: {
                                type: Type.ARRAY,
                                items: {
                                    type: Type.OBJECT,
                                    properties: {
                                        title: { type: Type.STRING },
                                        description: { type: Type.STRING },
                                        icon: { type: Type.STRING },
                                    },
                                    required: ["title", "description", "icon"],
                                }
                            }
                        }
                    }
                }
            });
            const parsed = parseJsonResponse<{ ideas: ToolIdea[] }>(response.text);
            return parsed.ideas;
        }

        const config = getProviderConfig(provider, apiKey);
        const body = JSON.stringify({
            model: model,
            messages: [{ role: 'user', content: prompt }],
            response_format: { type: 'json_object' }
        });

        const response = await fetch(config.url, { method: 'POST', headers: config.headers, body });
        if (!response.ok) throw new Error(`API Error: ${response.status}`);
        const data = await response.json();
        const rawContent = provider === AiProvider.Anthropic ? data.content[0].text : data.choices[0].message.content;
        
        return parseJsonResponse<{ ideas: ToolIdea[] }>(rawContent).ideas || [];
    });
}

/**
 * Intelligent Stream Cleaner to remove markdown artifacts on the fly.
 */
function cleanStreamChunk(chunk: string, isFirstChunk: boolean): string {
    let clean = chunk;
    if (isFirstChunk) {
        clean = clean.replace(/^\s*```html\s*/i, '').replace(/^\s*```\s*/i, '');
    }
    clean = clean.replace(/```\s*$/, '');
    return clean;
}

async function* generateStream(
    provider: AiProvider, 
    apiKey: string, 
    modelForProvider: string,
    prompt: string
): AsyncGenerator<string, void, unknown> {
    const model = modelForProvider;
    
    // SOTA System Instruction: Enforce Vanilla CSS for universal WP compatibility.
    const systemInstruction = `You are an Elite Frontend Engineer & SEO Expert.
OUTPUT RULES:
1. RAW VALID HTML5 ONLY.
2. DO NOT start with \`\`\`html.
3. Start directly with <!DOCTYPE html>.
4. NO conversational text.

TECH STACK:
- HTML5 (Semantic)
- CSS3 (Variables, Flex/Grid) -> **MUST BE VANILLA CSS**. DO NOT use Tailwind, Bootstrap, or external frameworks.
- ES6+ (No external libraries)

AEO & SEO MANDATES:
- Use <output> tags for calculation results.
- Use <article>, <section>, <label> tags.
- Inject a <script type="application/ld+json"> block with 'SoftwareApplication' schema.`;

    let isFirstChunk = true;

    if (provider === AiProvider.Gemini) {
        const ai = getGeminiClient(apiKey);
        const responseStream = await ai.models.generateContentStream({ 
            model, 
            contents: prompt,
            config: {
                systemInstruction: systemInstruction
            }
        });
        for await (const chunk of responseStream) {
            const text = cleanStreamChunk(chunk.text, isFirstChunk);
            if (text) {
                yield text;
                isFirstChunk = false;
            }
        }
        return;
    }

    const config = getProviderConfig(provider, apiKey);
    let body;
    const messages = [{ role: 'user', content: prompt }];

    if (provider === AiProvider.Anthropic) {
        body = JSON.stringify({
            model,
            system: systemInstruction,
            messages,
            stream: true,
            max_tokens: 4096,
        });
    } else {
        body = JSON.stringify({ 
            model, 
            messages: [{ role: 'system', content: systemInstruction }, ...messages], 
            stream: true 
        });
    }

    const response = await fetch(config.url, { method: 'POST', headers: config.headers, body });
    if (!response.ok || !response.body) throw new Error(`API Stream Error: ${response.status}`);

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        
        for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const data = line.substring(6);
            if (data.trim() === '[DONE]') return;
            try {
                const parsed = JSON.parse(data);
                let textChunk = '';
                if (provider === AiProvider.Anthropic) {
                    if (parsed.type === 'content_block_delta') textChunk = parsed.delta.text;
                } else {
                    if (parsed.choices?.[0]?.delta?.content) textChunk = parsed.choices[0].delta.content;
                }
                
                if (textChunk) {
                     const cleanChunk = cleanStreamChunk(textChunk, isFirstChunk);
                     if (cleanChunk) {
                        yield cleanChunk;
                        isFirstChunk = false;
                     }
                }
            } catch (e) { }
        }
    }
}

/**
 * Generates a Professional Grade SOTA Snippet optimized for SEO, AEO, and GEO.
 */
export async function generateSnippet(
    apiKey: string,
    provider: AiProvider,
    post: WordPressPost,
    idea: ToolIdea,
    model: string,
): Promise<AsyncGenerator<string, void, unknown>> {
    // SOTA PROMPT: Force self-contained styling for any WordPress theme.
    const prompt = `Task: Build a "Linkable Asset" HTML5 Tool.
    
Project: "${idea.title}"
Context: "${post.title.rendered}"
Description: "${idea.description}"

Specs:
1. **Design**: Modern "Glassmorphism" UI using **Vanilla CSS**.
   - Create a <style> block.
   - Use CSS Variables: --primary, --hover, --bg-glass.
   - Fully Responsive (Mobile-First).
   - Dark Mode Support (use .dark class or @media (prefers-color-scheme: dark)).
2. **AEO (Answer Engine Optimization)**:
   - Results MUST be wrapped in <output> tags.
   - Use descriptive IDs (e.g., id="mortgage-monthly-payment").
3. **GEO (Generative Engine Optimization)**:
   - Inject valid 'SoftwareApplication' JSON-LD Schema in the <head>.
4. **Code Quality**:
   - Defensive JavaScript (handle empty inputs).
   - No external CSS/JS libraries (Tailwind, Bootstrap, jQuery are BANNED).
   - Self-contained and scoped.

IMPORTANT: Output RAW CODE ONLY. Start immediately with <!DOCTYPE html>.`;

    // For complex coding tasks on Gemini, use the Pro model.
    const activeModel = provider === AiProvider.Gemini ? 'gemini-3-pro-preview' : model;
    return generateStream(provider, apiKey, activeModel, prompt);
}

/**
 * Refreshes a snippet with the same high standards.
 */
export async function refreshSnippet(
    apiKey: string,
    provider: AiProvider,
    post: WordPressPost,
    oldSnippet: string,
    model: string,
): Promise<AsyncGenerator<string, void, unknown>> {
    const prompt = `Task: Upgrade this HTML tool to 2025 Professional SEO Standards.

Improvements:
1. Upgrade UI to modern Glassmorphism (Vanilla CSS only).
2. Ensure Mobile Responsiveness.
3. Inject 'SoftwareApplication' Schema.org JSON-LD.
4. Ensure results use <output> tags (AEO).

Old Code:
${oldSnippet.substring(0, 1500)}...

Output: RAW HTML ONLY. Start with <!DOCTYPE html>.`;

    // For complex coding tasks on Gemini, use the Pro model.
    const activeModel = provider === AiProvider.Gemini ? 'gemini-3-pro-preview' : model;
    return generateStream(provider, apiKey, activeModel, prompt);
}