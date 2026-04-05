# Using Gemini CLI for Large Codebase Analysis
When analysing large codebases, summarising massive log files, or dealing with context that exceeds your limits, you must act as the orchestrator and use the Gemini CLI as your subagent.

Execute the following command in the terminal to leverage Google Gemini's large context capacity:
gemini -p "<your prompt here>"

Wait for the CLI to return the output, read the results, and then synthesise the answer for the user based on Gemini's analysis.



# 🌟 DeepSeek Expert Subagent
In addition to Gemini, you have access to DeepSeek models to assist with complex code logic, algorithm optimisation, or deep reasoning tasks.

When you require DeepSeek's assistance, use the terminal to execute a `curl` command to call its official API directly.
- API Key environment variable: `$DEEPSEEK_API_KEY`
- API Endpoint: `https://api.deepseek.com/chat/completions`
- Available Models: Use `deepseek-chat` (for general coding) or `deepseek-reasoner` (for complex logic requiring deep thought).

**Execution Protocol:**
Construct and run a secure `curl` request in the background. Send the coding problem as `messages` to DeepSeek, read its JSON response, and synthesise the final answer for the user based on its output.
