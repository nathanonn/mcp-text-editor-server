import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import * as path from "path";
import * as fs from "fs/promises";
import * as fsSync from "fs";

// Record of original file contents for undo operations
const fileBackups: Record<string, string> = {};

/**
 * Create an MCP server that simulates Anthropic's text editor tool
 * @param baseDir The directory to operate within
 */
async function createTextEditorServer(baseDir: string) {
  // Ensure the base directory exists
  try {
    await fs.mkdir(baseDir, { recursive: true });
    console.error(`Base directory: ${baseDir}`);
  } catch (err) {
    console.error(`Failed to create base directory: ${err}`);
    process.exit(1);
  }

  // Create an MCP server
  const server = new McpServer({
    name: "text-editor",
    version: "1.0.0",
  });

  // Helper: Validate that a path is within the base directory
  function validatePath(filePath: string): string {
    // Resolve to absolute path
    const resolvedPath = path.resolve(baseDir, filePath);

    // Check if path is within the base directory
    if (!resolvedPath.startsWith(path.resolve(baseDir))) {
      throw new Error(`Access denied: ${filePath} is outside the allowed directory`);
    }

    return resolvedPath;
  }

  // Helper: Create backup of a file
  async function backupFile(filePath: string): Promise<void> {
    try {
      if (fsSync.existsSync(filePath)) {
        const content = await fs.readFile(filePath, "utf-8");
        fileBackups[filePath] = content;
      }
    } catch (err) {
      console.error(`Failed to backup file: ${err}`);
    }
  }

  // Tool: View file content or list directory contents
  server.tool(
    "view",
    "View file content or directory listing",
    {
      path: z.string().describe("File or directory path relative to the base directory"),
      view_range: z
        .array(z.number())
        .optional()
        .describe("Optional range of lines to view [start, end]. Line numbers are 1-indexed and -1 for end means read to end of file."),
    },
    async ({ path: filePath, view_range }) => {
      try {
        const resolvedPath = validatePath(filePath);

        const stats = await fs.stat(resolvedPath);

        if (stats.isDirectory()) {
          // List directory contents
          const files = await fs.readdir(resolvedPath);
          const details = await Promise.all(
            files.map(async (file) => {
              const fileStats = await fs.stat(path.join(resolvedPath, file));
              return {
                name: file,
                type: fileStats.isDirectory() ? "directory" : "file",
                size: fileStats.size,
                modified: fileStats.mtime.toISOString(),
              };
            })
          );

          return {
            content: [
              {
                type: "text",
                text: `Directory: ${filePath}\n${JSON.stringify(details, null, 2)}`,
              },
            ],
          };
        } else {
          // Read file content
          const content = await fs.readFile(resolvedPath, "utf-8");

          // Handle view_range if provided
          if (view_range && view_range.length === 2) {
            const lines = content.split("\n");
            const startLine = Math.max(0, view_range[0] - 1); // Convert 1-indexed to 0-indexed
            const endLine = view_range[1] === -1 ? lines.length - 1 : Math.min(lines.length - 1, view_range[1] - 1);

            if (startLine <= endLine) {
              const selectedLines = lines.slice(startLine, endLine + 1);
              // Add line numbers to the output
              const numberedLines = selectedLines.map((line, idx) => `${startLine + idx + 1}: ${line}`);

              return {
                content: [
                  {
                    type: "text",
                    text: numberedLines.join("\n"),
                  },
                ],
              };
            }
          }

          // If no view_range or invalid range, return the full content with line numbers
          const lines = content.split("\n");
          const numberedLines = lines.map((line, idx) => `${idx + 1}: ${line}`);

          return {
            content: [
              {
                type: "text",
                text: numberedLines.join("\n"),
              },
            ],
          };
        }
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);

        return {
          content: [
            {
              type: "text",
              text: `Error: ${errorMessage}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // Tool: Replace text in a file
  server.tool(
    "str_replace",
    "Replace text in a file",
    {
      path: z.string().describe("File path relative to the base directory"),
      old_str: z.string().describe("Text to replace"),
      new_str: z.string().describe("New text"),
      count: z.number().optional().describe("Number of occurrences to replace (all if not specified)"),
    },
    async ({ path: filePath, old_str, new_str, count }) => {
      try {
        const resolvedPath = validatePath(filePath);

        // Ensure file exists
        if (!fsSync.existsSync(resolvedPath)) {
          throw new Error(`File does not exist: ${filePath}`);
        }

        // Backup file before modification
        await backupFile(resolvedPath);

        // Read file content
        let content = await fs.readFile(resolvedPath, "utf-8");

        // Perform replacement
        if (count !== undefined && count > 0) {
          let replaceCount = 0;
          content = content.replace(new RegExp(escapeRegExp(old_str), "g"), (match) => {
            if (replaceCount < count) {
              replaceCount++;
              return new_str;
            }
            return match;
          });
        } else {
          // Replace all occurrences
          content = content.replace(new RegExp(escapeRegExp(old_str), "g"), new_str);
        }

        // Write modified content back to file
        await fs.writeFile(resolvedPath, content);

        return {
          content: [
            {
              type: "text",
              text: `Successfully replaced text in ${filePath}`,
            },
          ],
        };
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);

        return {
          content: [
            {
              type: "text",
              text: `Error: ${errorMessage}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // Tool: Edit lines in a file based on line numbers
  server.tool(
    "edit",
    "Edit specific lines in a file, replacing them with new content",
    {
      path: z.string().describe("File path relative to the base directory"),
      start_line: z.number().describe("Start line number to edit (1-indexed)"),
      end_line: z.number().describe("End line number to edit (1-indexed)"),
      new_content: z.string().describe("New content to replace the specified lines"),
    },
    async ({ path: filePath, start_line, end_line, new_content }) => {
      try {
        const resolvedPath = validatePath(filePath);

        // Ensure file exists
        if (!fsSync.existsSync(resolvedPath)) {
          throw new Error(`File does not exist: ${filePath}`);
        }

        // Backup file before modification
        await backupFile(resolvedPath);

        // Read file content
        let content = await fs.readFile(resolvedPath, "utf-8");

        // Split into lines
        const lines = content.split("\n");

        // Validate line numbers
        if (start_line < 1 || start_line > lines.length) {
          throw new Error(
            `Invalid start_line parameter: ${start_line}. It should be within the range of lines of the file: [1, ${lines.length}]`
          );
        }

        // Adjust end_line if needed (allow -1 to mean "to the end")
        const effectiveEndLine = end_line === -1 ? lines.length : end_line;

        if (effectiveEndLine < start_line || effectiveEndLine > lines.length) {
          throw new Error(`Invalid end_line parameter: ${end_line}. It should be within the range [${start_line}, ${lines.length}] or -1`);
        }

        // Convert to 0-indexed
        const startIndex = start_line - 1;
        const endIndex = effectiveEndLine - 1;

        // Get the old content for display
        const oldContent = lines.slice(startIndex, endIndex + 1).join("\n");

        // Replace the specified lines
        const newLines = new_content.split("\n");

        // Create the new content by replacing the specified lines
        const updatedLines = [...lines.slice(0, startIndex), ...newLines, ...lines.slice(endIndex + 1)];

        // Join lines and write back to file
        await fs.writeFile(resolvedPath, updatedLines.join("\n"));

        return {
          content: [
            {
              type: "text",
              text: `Successfully edited lines ${start_line}-${effectiveEndLine} in ${filePath}\n\nOld content:\n${oldContent}\n\nNew content:\n${new_content}`,
            },
          ],
        };
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);

        return {
          content: [
            {
              type: "text",
              text: `Error: ${errorMessage}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // Tool: Insert content at a specific line number
  server.tool(
    "insert",
    "Insert content at a specific line number",
    {
      path: z.string().describe("File path relative to the base directory"),
      line_number: z.number().describe("Line number to insert at (1-based)"),
      text: z.string().describe("Text to insert"),
    },
    async ({ path: filePath, line_number, text }) => {
      try {
        const resolvedPath = validatePath(filePath);

        // Ensure file exists
        if (!fsSync.existsSync(resolvedPath)) {
          throw new Error(`File does not exist: ${filePath}`);
        }

        // Backup file before modification
        await backupFile(resolvedPath);

        // Read file content
        let content = await fs.readFile(resolvedPath, "utf-8");

        // Split into lines
        const lines = content.split("\n");

        // Validate line number
        if (line_number < 1) {
          throw new Error("Line number must be at least 1");
        }

        // Insert at specified line (or append if beyond file length)
        if (line_number <= lines.length) {
          lines.splice(line_number - 1, 0, text);
        } else {
          // Pad with empty lines if necessary
          while (lines.length < line_number - 1) {
            lines.push("");
          }
          lines.push(text);
        }

        // Join lines and write back to file
        await fs.writeFile(resolvedPath, lines.join("\n"));

        return {
          content: [
            {
              type: "text",
              text: `Successfully inserted text at line ${line_number} in ${filePath}`,
            },
          ],
        };
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);

        return {
          content: [
            {
              type: "text",
              text: `Error: ${errorMessage}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // Tool: Create a new file
  server.tool(
    "create",
    "Create a new file",
    {
      path: z.string().describe("File path relative to the base directory"),
      content: z.string().describe("Content to write to the file"),
      overwrite: z.boolean().optional().default(false).describe("Whether to overwrite if file exists"),
    },
    async ({ path: filePath, content, overwrite }) => {
      try {
        const resolvedPath = validatePath(filePath);

        // Check if file exists and handle overwrite flag
        if (fsSync.existsSync(resolvedPath) && !overwrite) {
          throw new Error(`File already exists: ${filePath}. Use overwrite=true to replace it.`);
        }

        // Create parent directories if they don't exist
        const parentDir = path.dirname(resolvedPath);
        await fs.mkdir(parentDir, { recursive: true });

        // Backup existing file if overwriting
        if (fsSync.existsSync(resolvedPath)) {
          await backupFile(resolvedPath);
        }

        // Write content to file
        await fs.writeFile(resolvedPath, content);

        return {
          content: [
            {
              type: "text",
              text: `Successfully created file: ${filePath}`,
            },
          ],
        };
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);

        return {
          content: [
            {
              type: "text",
              text: `Error: ${errorMessage}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // Tool: Undo the last edit to a file
  server.tool(
    "undo_edit",
    "Restore a file from its backup",
    {
      path: z.string().describe("File path relative to the base directory"),
    },
    async ({ path: filePath }) => {
      try {
        const resolvedPath = validatePath(filePath);

        // Check if we have a backup for this file
        if (!fileBackups[resolvedPath]) {
          throw new Error(`No backup available for ${filePath}`);
        }

        // Restore from backup
        await fs.writeFile(resolvedPath, fileBackups[resolvedPath]);

        // Remove the backup
        delete fileBackups[resolvedPath];

        return {
          content: [
            {
              type: "text",
              text: `Successfully restored ${filePath} from backup`,
            },
          ],
        };
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        return {
          content: [
            {
              type: "text",
              text: `Error: ${errorMessage}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // Helper function to escape special characters in regex
  function escapeRegExp(string: string): string {
    return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  // Start the server with the stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error("Text editor MCP server running");
}

// Get the base directory from command line arguments
const baseDir = process.argv[2] || "./texteditor-data";

// Start the server
createTextEditorServer(baseDir).catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
