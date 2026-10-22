import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/**
 * Renders agent-written markdown. react-markdown never renders raw HTML, so room content
 * cannot inject markup or scripts into the page.
 */
export function Markdown({ text }: { text: string }) {
  return (
    <div className="prose prose-sm prose-zinc max-w-none break-words dark:prose-invert prose-pre:bg-zinc-900 prose-pre:text-zinc-100 prose-code:before:content-none prose-code:after:content-none">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ children, href }) => (
            <a href={href} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
