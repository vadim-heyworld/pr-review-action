import { OpenAI } from 'openai';

import { FileChange, ReviewComment } from '../types/index.js';

export class OpenAIService {
  private readonly model: string;
  private readonly openai: OpenAI;

  constructor(openAI: OpenAI, model: string) {
    this.model = model;
    this.openai = openAI;
  }

  async analyzePRChanges(fileChange: FileChange, projectPrompts: string): Promise<ReviewComment[]> {
    const diffDescription = fileChange.hunks
      .map(hunk => {
        return `Changes at lines ${hunk.newStart}-${hunk.newStart + hunk.newLines}:\n${hunk.content}`;
      })
      .join('\n\n');

    const response = await this.openai.chat.completions.create({
      model: this.model,
      messages: [
        {
          role: 'system',
          content: this.buildSystemPrompt(projectPrompts),
        },
        {
          role: 'user',
          content: `File: ${fileChange.filename}\n\nChanges:\n${diffDescription}`,
        },
      ],
    });

    return this.parseResponse(response.choices[0].message.content || '', fileChange);
  }

  async analyzePRInfo(
    prDescription: string,
    fileCount: number,
    branchName: string,
    commitMessages: string[]
  ): Promise<string> {
    const response = await this.openai.chat.completions.create({
      model: this.model,
      messages: [
        {
          role: 'system',
          content: this.buildPRInfoPrompt(),
        },
        {
          role: 'user',
          content: `
          PR Description:
          ${prDescription}
          Number of files changed: ${fileCount}
          Branch name: ${branchName}
          Commit messages: ${commitMessages.join(', ')}
          Please analyze the PR description and file count based on the provided guidelines.
          `,
        },
      ],
    });

    return response.choices[0].message.content || '';
  }

  private buildSystemPrompt(projectPrompts: string): string {
    return `
      You are the most clever and intelligent developer in our team who ALWAYS follows all the provided guidelines and rules.
      Review the given changes and follow the following instructions:

      #INSTRUCTIONS#
      You:
      - MUST always follow the guidelines:\n${projectPrompts}
      - MUST NEVER HALLUCINATE
      - MUST NOT bring changes overview, ONLY analyze the changes
      - DENIED to overlook the critical context
      - MUST ALWAYS follow #Answering rules#
      - MUST ALWAYS be short and to the point
      - MUST ALWAYS provide comments in the following format:
                [LINE_NUMBER]: Comment text
                [LINE_NUMBER]: Another comment text
      - SHOULD NOT provide unnecessary comments and information
      - MUST reference line numbers from the new file for additions/modifications
      - MUST use the actual line numbers from the diff hunks provided

      #Answering Rules#
      Follow in the strict order:
      1. USE the language of my message
      2. You MUST combine your deep knowledge of the topic and clear thinking
      3. Answer the question in a natural, human-like manner
      4. DONT provide unnecessary information
      5. DONT tell me about the changes that were made by author, only analyze the changes`;
  }

  private buildPRInfoPrompt(): string {
    return `
      You are an expert code reviewer. Analyze the given PR description and stats. Your comment HAS to be informative but short as possible.
      Follow these guidelines:
      - PR MUST NOT be larger than 30 files.
      - Optimally they SHOULD include no more than 20 files.
      - Branch name MUST follow this naming rule: '<type>/<issue-key>-<description>'
      - Every commit MUST have a prefix with the corresponding issue key
      - PR that change a small thing MUST NOT include any other changes.
      - PR MUST focus on one thing
      - Check if the PR description is adequate
      - Provide constructive feedback
      - Be concise and specific in your analysis
    `;
  }

  private parseResponse(content: string, fileChange: FileChange): ReviewComment[] {
    return content
      .split('\n')
      .map(line => {
        const match = line.match(/^\[(\d+)\]:\s(.+)$/);
        if (match) {
          const lineNumber = parseInt(match[1]);
          const hunk = fileChange.hunks.find(
            h => lineNumber >= h.newStart && lineNumber <= h.newStart + h.newLines
          );
          if (hunk) {
            return { line: lineNumber, comment: match[2] };
          }
        }
        return null;
      })
      .filter((comment): comment is ReviewComment => comment !== null);
  }
}