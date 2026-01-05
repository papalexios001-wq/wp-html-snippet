import React, { useState } from 'react';
import { Button } from './common/Button';
import { ClipboardIcon } from './icons/ActionIcons';
import { CheckIcon } from './icons/CheckIcon';

interface SetupInstructionsProps {
  onRetryConnection: () => void;
}

const phpCode = `// --- HTML Snippet AI Connector v3.1 ---
// Fixes the "Code Stripping" issue by bypassing default WP sanitization for the secure field.

if ( ! class_exists( 'HTMLSnippetAI_Connector' ) ) {
    /**
     * The main connector class for HTML Snippet AI.
     * Handles CPT registration, meta fields, and shortcode rendering securely.
     */
    final class HTMLSnippetAI_Connector {

        private static $instance;

        public static function get_instance() {
            if ( null === self::$instance ) {
                self::$instance = new self();
            }
            return self::$instance;
        }

        private function __construct() {
            add_action( 'init', array( $this, 'register_tool_cpt' ) );
            add_action( 'init', array( $this, 'register_meta_field' ) );
            add_action( 'init', array( $this, 'register_shortcode' ) );
        }

        public function register_tool_cpt() {
            $args = array(
                'public'       => false,
                'show_ui'      => true,
                'label'        => 'AI-Generated Tools',
                'menu_icon'    => 'dashicons-sparkles',
                'supports'     => array( 'title', 'editor' ), 
                'show_in_rest' => true,
            );
            register_post_type( 'cf_tool', $args );
        }
        
        /**
         * Registers a secure meta field to store the raw HTML snippet.
         * CRITICAL: Includes sanitize_callback to allow raw HTML.
         */
        public function register_meta_field() {
            register_post_meta( 'cf_tool', '_cf_tool_html_snippet', array(
                'show_in_rest'  => true,
                'single'        => true,
                'type'          => 'string',
                'auth_callback' => function() {
                    return current_user_can( 'edit_posts' );
                },
                // v3.1 FIX: Allow raw HTML/JS to be saved. 
                // Default 'string' type strips tags, which breaks the tools.
                'sanitize_callback' => function( $meta_value ) {
                    return $meta_value; 
                }
            ) );
        }

        public function register_shortcode() {
            add_shortcode( 'contentforge_tool', array( $this, 'render_tool_shortcode' ) );
        }

        public function render_tool_shortcode( $atts ) {
            $atts = shortcode_atts( array( 'id' => '' ), $atts, 'contentforge_tool' );

            if ( empty( $atts['id'] ) || ! is_numeric( $atts['id'] ) ) {
                return '<!-- HTML Snippet AI: Invalid Tool ID -->';
            }

            $tool_id = (int) $atts['id'];
            $tool_post = get_post( $tool_id );

            if ( ! $tool_post || 'cf_tool' !== $tool_post->post_type || 'publish' !== $tool_post->post_status ) {
                return '<!-- HTML Snippet AI: Tool not found or not published -->';
            }

            $html_snippet = get_post_meta( $tool_id, '_cf_tool_html_snippet', true );

            if ( ! empty( $html_snippet ) ) {
                return $html_snippet;
            }

            return $tool_post->post_content;
        }
    }

    HTMLSnippetAI_Connector::get_instance();
}`;

const StepCard: React.FC<{ number: number; title: string; children: React.ReactNode }> = ({ number, title, children }) => (
    <div className="flex items-start gap-4 p-4 bg-white/60 dark:bg-slate-800/60 rounded-xl border border-slate-200 dark:border-slate-700">
        <div className="flex-shrink-0 w-8 h-8 flex items-center justify-center bg-blue-600 text-white font-bold rounded-full">{number}</div>
        <div>
            <h4 className="font-bold text-slate-900 dark:text-slate-100">{title}</h4>
            <div className="text-sm text-slate-600 dark:text-slate-300">{children}</div>
        </div>
    </div>
);


const SetupInstructions: React.FC<SetupInstructionsProps> = ({ onRetryConnection }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(phpCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  return (
    <div className="animate-fade-in space-y-10">
      <div className="text-center">
        <h2 className="text-3xl font-extrabold text-slate-900 dark:text-slate-100 tracking-tight">Update Required: Activate Connector v3.1</h2>
        <p className="mt-2 text-lg text-slate-600 dark:text-slate-300 max-w-3xl mx-auto">
            We've updated the connector to fix an issue where WordPress was stripping code from saved tools. Please update your snippet to continue.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-8 text-left items-start">
        {/* Left Side: Instructions */}
        <div className="lg:col-span-2 space-y-4">
            <h3 className="text-xl font-bold text-slate-900 dark:text-slate-100">How to Update</h3>
            <StepCard number={1} title="Open WPCode (or your snippet plugin)">
                <p>Go to your WordPress dashboard and find the "HTML Snippet AI Connector" snippet you created previously.</p>
            </StepCard>
            <StepCard number={2} title="Replace the Code">
                <p>Delete the old code entirely. Click "Copy Code" on the right and paste the new v3.1 code into the editor.</p>
            </StepCard>
            <StepCard number={3} title="Save/Update">
                <p>Click "Update" or "Save Snippet". Ensure the switch is still set to <strong className="text-green-600 dark:text-green-400">Active</strong>.</p>
            </StepCard>
             <StepCard number={4} title="Reconnect">
                <p>Once saved, come back here and click the button below to verify the connection.</p>
            </StepCard>
        </div>

        {/* Right Side: Code Block */}
        <div className="lg:col-span-3 bg-slate-900 rounded-lg shadow-2xl shadow-slate-400/20 dark:shadow-black/50 overflow-hidden border border-slate-700/50 h-full flex flex-col">
          <div className="flex-shrink-0 flex justify-between items-center px-4 py-2 bg-slate-800/50 border-b border-slate-700/50">
            <span className="text-sm font-mono text-slate-300">Secure AI Connector v3.1</span>
            <button
              onClick={handleCopy}
              className="flex items-center gap-2 text-sm font-medium text-slate-300 hover:text-white transition-colors"
            >
              {copied ? <CheckIcon className="w-4 h-4 text-green-400" /> : <ClipboardIcon className="w-4 h-4" />}
              {copied ? 'Copied!' : 'Copy Code'}
            </button>
          </div>
          <div className="p-4 flex-grow overflow-auto max-h-[50vh]">
            <pre><code className="text-sm text-slate-100 whitespace-pre-wrap break-words">
              {phpCode}
            </code></pre>
          </div>
        </div>
      </div>
      
      <div className="mt-8 text-center">
        <Button onClick={onRetryConnection} size="large">
          I've Updated the Code, Connect Now!
        </Button>
      </div>
    </div>
  );
};

export default SetupInstructions;