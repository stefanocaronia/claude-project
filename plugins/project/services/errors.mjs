// The errors a command prints as a message, without a stack: what went wrong and how to fix it.

/** An error the command line prints as a message, without a stack. */
export class ProjectError extends Error
{
}

/** Stops a command with a message for the user: a ProjectError, which runCli prints. */
export function fail(message)
{
    throw new ProjectError(message);
}

/** The first line of an error's message: what a message for the user takes of it. */
export function firstLine(error)
{
    return String(error?.message ?? error).split("\n")[0];
}
