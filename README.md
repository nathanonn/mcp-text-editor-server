# MCP Text Editor Server

A Model Context Protocol (MCP) server that implements Anthropic's text editor tool functionality. This server allows Claude and other MCP clients to read and modify files within a specified directory.

## Features

The server implements the same commands as Anthropic's text editor tool, plus an enhanced edit command:

- **`view`**: Examine file content or list directory contents
  - View entire files or specific line ranges with line numbers
  - Browse directory listings with file metadata
- **`str_replace`**: Make precise text replacements

  - Replace specific strings with new text
  - Optionally limit the number of replacements
  - Best for simple, targeted replacements

- **`edit`**: Edit blocks of code by line numbers

  - Replace entire ranges of lines with new content
  - Safer than str_replace for major code modifications
  - Shows before/after comparison of changes

- **`insert`**: Add new content at specific line numbers

  - Insert text after a specified line
  - Add content even beyond the current file length

- **`create`**: Create new files or overwrite existing ones

  - Create files with specified content
  - Optionally overwrite existing files

- **`undo_edit`**: Restore files from backups
  - Revert to the state before the last modification
  - Automatic backup creation for every edit

## Installation

### Prerequisites

- Node.js 16 or higher
- TypeScript

### Set Up

1. **Create a new project**:

   ```bash
   mkdir text-editor-mcp
   cd text-editor-mcp
   npm init -y
   ```

2. **Install dependencies**:

   ```bash
   npm install @modelcontextprotocol/sdk zod
   npm install -D @types/node typescript
   ```

3. **Create a TypeScript configuration**:
   Create a `tsconfig.json` file:

   ```json
   {
     "compilerOptions": {
       "target": "ES2022",
       "module": "Node16",
       "moduleResolution": "Node16",
       "outDir": "./build",
       "esModuleInterop": true,
       "strict": true
     },
     "include": ["*.ts"]
   }
   ```

4. **Save the source code**:
   Save the text editor server code as `text-editor-server.ts` in your project.

5. **Compile**:
   ```bash
   npx tsc
   ```

## Usage

### Running the Server

```bash
node build/text-editor-server.js /path/to/working/directory
```

If you don't specify a directory, it defaults to `./texteditor-data`.

### Integrating with Claude for Desktop

1. Open your Claude for Desktop configuration file:

   - macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
   - Windows: `%APPDATA%\Claude\claude_desktop_config.json`

2. Add the server to your configuration:

   ```json
   {
     "mcpServers": {
       "text-editor": {
         "command": "node",
         "args": ["/absolute/path/to/build/text-editor-server.js", "/absolute/path/to/working/directory"]
       }
     }
   }
   ```

3. Restart Claude for Desktop.

## Command Reference

### View Command

View file content or directory listings.

**Parameters:**

- `path` (required): File or directory path relative to the base directory
- `view_range` (optional): Array of two integers specifying line range to view (e.g., `[1, 10]`)
  - Line numbers are 1-indexed
  - Use `-1` for the end line to read to the end of the file

**Example Usage in Claude:**
"Show me the content of main.py"
"Show me lines 10-20 of server.js"
"List the files in the projects directory"

### Str_Replace Command

Replace specific text in files. Best for simple, targeted text replacements.

**Parameters:**

- `path` (required): File path relative to the base directory
- `old_str` (required): Text to replace
- `new_str` (required): New text
- `count` (optional): Number of occurrences to replace (all if not specified)

**Example Usage in Claude:**
"Replace 'function' with 'method' in utils.js"
"Replace the first occurrence of 'error' with 'exception' in error_handler.py"

### Edit Command

Edit a range of lines in a file. This is safer than `str_replace` for editing larger blocks of code.

**Parameters:**

- `path` (required): File path relative to the base directory
- `start_line` (required): First line number to edit (1-based)
- `end_line` (required): Last line number to edit (1-based, or -1 for "to the end of file")
- `new_content` (required): New content to replace the specified line range

**Example Usage in Claude:**
"Edit lines 10-15 in server.js to implement proper error handling"
"Replace the function starting at line 25 with this improved version"

### Insert Command

Insert text at specific line numbers.

**Parameters:**

- `path` (required): File path relative to the base directory
- `line_number` (required): Line number to insert at (1-based)
- `text` (required): Text to insert

**Example Usage in Claude:**
"Insert a docstring after line 5 in main.py"
"Add a new import statement at line 1 of app.js"

### Create Command

Create new files with specified content.

**Parameters:**

- `path` (required): File path relative to the base directory
- `content` (required): Content to write to the file
- `overwrite` (optional): Whether to overwrite if file exists (default: false)

**Example Usage in Claude:**
"Create a new file named config.json with these settings"
"Create a Python script that prints 'Hello World'"

### Undo_Edit Command

Restore files from backups.

**Parameters:**

- `path` (required): File path relative to the base directory

**Example Usage in Claude:**
"Undo my last edit to README.md"
"Revert the changes to server.js"

## Security Features

The server includes several important security measures:

1. **Path validation**: Ensures operations stay within the specified base directory
2. **Automatic backups**: Creates backups before modifying files
3. **Error handling**: Provides clear error messages for failed operations
4. **Directory creation**: Automatically creates the base directory if it doesn't exist

## Example Conversations

Here are some example conversations to try with Claude:

- "Can you create a new Python script that calculates the Fibonacci sequence?"
- "I have a JavaScript file with some syntax errors. Can you check it and fix them?"
- "Please add proper docstrings to all functions in my Python file."
- "I need to refactor this code to use async/await. Can you help?"
- "Create a config file with the following settings..."

## Usage Rules for Claude

These rules help Claude determine when and how to use the text editor tool:

```
For ANY request involving viewing, editing, creating, or modifying files:

1. When you need to view file content:
   + Use the "view" command with the file path
   + For large files, use view_range parameter to see specific sections

2. When you need to edit existing files:
   + First use "view" to see the current content
   + For simple text replacements, use "str_replace" with old_str and new_str
   + For editing blocks of code or multiple lines, use "edit" with start_line, end_line, and new_content
   + For adding new content at a specific location, use "insert" with line_number and text

3. When you need to create new files:
   + Use "create" with path and content parameters
   + If replacing an existing file, set overwrite to true

4. If a user is unhappy with changes:
   + Use "undo_edit" to revert the most recent change to a file

Always confirm you've made the requested changes and summarize what you've done. When possible, show the relevant portions of the file before and after changes.
```

You can include these rules in your Claude prompts to help guide the model on when and how to use the text editor tool.

## Usage Rules for Claude

These rules help Claude determine when and how to use the text editor tool:

```
For ANY request involving viewing, editing, creating, or modifying files:

1. When you need to view file content:
   + Use the "view" command with the file path
   + For large files, use view_range parameter to see specific sections

2. When you need to edit existing files:
   + First use "view" to see the current content
   + For simple replacements, use "str_replace" with old_str and new_str
   + For adding new content at a specific location, use "insert" with line_number and text

3. When you need to create new files:
   + Use "create" with path and content parameters
   + If replacing an existing file, set overwrite to true

4. If a user is unhappy with changes:
   + Use "undo_edit" to revert the most recent change to a file

Always confirm you've made the requested changes and summarize what you've done. When possible, show the relevant portions of the file before and after changes.
```

You can include these rules in your Claude prompts to help guide the model on when and how to use the text editor tool.

## Troubleshooting

If you encounter issues:

1. Check the server logs
2. Verify paths are correct
3. Ensure the working directory is writable
4. Check that Claude for Desktop configuration is correct
5. Restart Claude for Desktop after configuration changes

## License

MIT

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.
