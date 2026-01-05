import { WordPressConfig, WordPressPost } from '../types';
import { SHORTCODE_DETECTION_REGEX } from '../constants';

const POSTS_PER_PAGE = 20;

async function fetchWithTimeout(resource: RequestInfo, options: RequestInit & { timeout?: number } = {}): Promise<Response> {
    const { timeout = 15000 } = options; 
    
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);
  
    const response = await fetch(resource, {
      ...options,
      signal: controller.signal  
    });
    
    clearTimeout(id);
    return response;
}

function getApiUrl(config: WordPressConfig, endpoint: string): string {
    const url = config.url.endsWith('/') ? config.url : `${config.url}/`;
    return `${url}wp-json/wp/v2/${endpoint}`;
}

function getAuthHeader(config: WordPressConfig): string {
    return `Basic ${btoa(`${config.username}:${config.appPassword}`)}`;
}

export async function checkSetup(config: WordPressConfig): Promise<boolean> {
    const url = `${config.url.endsWith('/') ? config.url : `${config.url}/`}wp-json/wp/v2/types/cf_tool`;
    try {
        const response = await fetchWithTimeout(url, {
            method: 'GET',
            headers: { 'Authorization': getAuthHeader(config) },
        });

        if (response.status === 404) return false;
        if (response.status === 401) throw new Error('Authentication failed. Check username/app password.');
        if (!response.ok) throw new Error(`Setup check failed: ${response.status}`);
        return true;
    } catch (error: any) {
        console.error("Setup check failed:", error);
        if (error.name === 'AbortError') throw new Error('CONNECTION_FAILED: Request timed out. Server too slow.');
        if (error instanceof TypeError) throw new Error('CONNECTION_FAILED: Network error (CORS/Offline).');
        throw error;
    }
}


export async function fetchPosts(config: WordPressConfig, page: number = 1): Promise<{ posts: WordPressPost[], totalPages: number }> {
    const url = getApiUrl(config, `posts?_fields=id,title,content,link,_links&per_page=${POSTS_PER_PAGE}&page=${page}&status=publish&_embed=wp:featuredmedia`);
    try {
        const response = await fetchWithTimeout(url, { headers: { 'Authorization': getAuthHeader(config) } });

        if (!response.ok) {
            if (response.status === 401) throw new Error('Authentication failed.');
            throw new Error(`Failed to fetch posts. Status: ${response.status}`);
        }

        const totalPages = parseInt(response.headers.get('X-WP-TotalPages') || '1', 10);
        const postsData: any[] = await response.json();
        
        const posts: WordPressPost[] = postsData.map(post => {
            const featuredMedia = post._embedded?.['wp:featuredmedia'];
            const featuredImageUrl = featuredMedia?.[0]?.source_url || null;
            const match = post.content.rendered.match(SHORTCODE_DETECTION_REGEX);
            const hasOptimizerSnippet = !!match;
            const toolId = match ? parseInt(match[1], 10) : undefined;

            return {
                id: post.id,
                title: post.title,
                content: post.content,
                link: post.link,
                featuredImageUrl: featuredImageUrl,
                hasOptimizerSnippet,
                toolId,
            };
        });

        return { posts, totalPages };
    } catch (error: any) {
        if (error.name === 'AbortError') throw new Error('CONNECTION_FAILED: Timeout.');
        if (error instanceof TypeError) throw new Error('CONNECTION_FAILED: Network Error.');
        throw error;
    }
}

export async function updatePost(config: WordPressConfig, postId: number, content: string): Promise<WordPressPost> {
    const url = getApiUrl(config, `posts/${postId}`);
    try {
        const response = await fetchWithTimeout(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': getAuthHeader(config) },
            body: JSON.stringify({ content: content }),
        });

        if (!response.ok) throw new Error(`Failed to update post. Status: ${response.status}`);
        
        const updatedPostData: any = await response.json();
        const match = updatedPostData.content.rendered.match(SHORTCODE_DETECTION_REGEX);
        const hasOptimizerSnippet = !!match;
        const toolId = match ? parseInt(match[1], 10) : undefined;

        return {
            id: updatedPostData.id,
            title: updatedPostData.title,
            content: updatedPostData.content,
            link: updatedPostData.link,
            featuredImageUrl: null,
            hasOptimizerSnippet,
            toolId,
        };
    } catch (error: any) {
        throw error;
    }
}


export async function createCfTool(config: WordPressConfig, title: string, content: string): Promise<{ id: number }> {
  const url = getApiUrl(config, 'cf_tool');
  try {
    const response = await fetchWithTimeout(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': getAuthHeader(config) },
      body: JSON.stringify({
        title: title,
        content: '<!-- AI Tool HTML is stored in a custom meta field for security. -->',
        status: 'publish',
        meta: { _cf_tool_html_snippet: content }
      }),
    });

    if (!response.ok) throw new Error(`Failed to create tool post. Status: ${response.status}`);
    
    const toolData = await response.json();

    // SOTA VERIFICATION: Zero-Trust Verification
    // We must confirm the server actually saved the meta field.
    // If the PHP connector is outdated or standard WP sanitization ran, the snippet might be empty.
    
    let savedSnippet = toolData.meta?._cf_tool_html_snippet;

    if (!savedSnippet) {
         // Double check with a fresh fetch, just in case response body was partial.
         const verifyResponse = await fetchWithTimeout(`${url}/${toolData.id}`, { headers: { 'Authorization': getAuthHeader(config) } });
         const verifyData = await verifyResponse.json();
         savedSnippet = verifyData.meta?._cf_tool_html_snippet;
    }

    // If it is STILL empty, the connector is broken or WP is stripping tags.
    if (!savedSnippet || savedSnippet.trim().length === 0) {
        // Cleanup the broken tool so we don't leave trash
        await deleteCfTool(config, toolData.id).catch(() => {}); 
        
        throw new Error(
            'CONNECTOR_OUTDATED: The "AI Connector" on your WordPress site is blocking the code. ' +
            'It failed to save the HTML snippet. ' +
            'Please go to the main dashboard, disconnect, and update your PHP Snippet to v3.1 as shown in the instructions.'
        );
    }

    return toolData;
  } catch (error: any) {
    if (error.message.includes('CONNECTOR_OUTDATED')) throw error;
    if (error.name === 'AbortError') throw new Error('Timeout creating tool.');
    throw error;
  }
}

export async function deleteCfTool(config: WordPressConfig, toolId: number): Promise<void> {
  const url = getApiUrl(config, `cf_tool/${toolId}?force=true`);
  try {
    const response = await fetchWithTimeout(url, {
      method: 'DELETE',
      headers: { 'Authorization': getAuthHeader(config) },
    });
    if (!response.ok && response.status !== 404) throw new Error(`Failed to delete tool. Status: ${response.status}`);
  } catch (error) {
    throw error;
  }
}

export async function fetchCfTool(config: WordPressConfig, toolId: number): Promise<{ id: number; title: { rendered: string }; content: { rendered: string } }> {
    const url = getApiUrl(config, `cf_tool/${toolId}?_fields=id,title,content,meta`);
    try {
        const response = await fetchWithTimeout(url, { headers: { 'Authorization': getAuthHeader(config) } });
        if (!response.ok) throw new Error(`Failed to fetch tool.`);
        const toolData = await response.json();
        const snippet = toolData.meta?._cf_tool_html_snippet || toolData.content?.rendered || '';
        return {
            id: toolData.id,
            title: toolData.title,
            content: { rendered: snippet }
        };
    } catch (error) {
        throw error;
    }
}

export async function updateCfTool(config: WordPressConfig, toolId: number, title: string, content: string): Promise<{ id: number }> {
    const url = getApiUrl(config, `cf_tool/${toolId}`);
    try {
        const response = await fetchWithTimeout(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': getAuthHeader(config) },
            body: JSON.stringify({ 
                title, 
                meta: { _cf_tool_html_snippet: content }
            }),
        });
        if (!response.ok) throw new Error(`Failed to update tool.`);
        return await response.json();
    } catch (error) {
        throw error;
    }
}