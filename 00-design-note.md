# Summary

I implemented a basic feature for integrating the dialog saved (with /chat save)
with git. Typically, if I want to experiment with a new feature on my codebase,
I would take a git snapshot, then proceed with (vibe)coding. However, the
snapshot and dialog are not linked explicitly, so it may be hard to align them
in the future. Gemini does have something like this, but they make a "shadow"
copy of your repo, and keep track of snapshots there. It seems to me a more
natural solution is to make use of version control already in place in your
repo.

## Command explanation

The new slash command is called chat-git (better name suggestions welcome...)

    > /chat-git

It has 4 subcommands: list List tags of conversations checkpointed by chat-git
save Save the current conversation as a checkpoint and commit current state to
git. Usage: /chat-git save <tag> resume Resume a conversation and snapshot from
a checkpoint. Usage: /chat-git resume <tag> delete Delete a conversation
checkpoint (git snapshot remains). Usage: /chat-git delete <tag>

In this basic version, there are some limitations and some defaults are used:

- save adds everything (git add -A) and commits without running tests/eslint
  (git commit --no-verify) and uses a standard commit message ("commit made with
  chat-git tag <tag>")
- currently the commit is made without advancing the working branch
- delete deletes the conversation but doesn't remove the git snapshot
- **future work** add git worktree; it is not uncommon to spin up several
  instances of a coding agent and run them in parallel, whether on the same
  request or different ones. With git worktree, multiple copies of your repo are
  made, and one could (with the future version of this workflow) easily switch
  between them.

## Quick overview of implementation

The current implementation essentially replicates the /chat command, and adds
the git commands wherever necessary, and keeps track of (tag, commit hash) pairs
in a .json file that is located in the .gemini folder in the root directory of
your repo. In the future, if this feature is adopted, it may be wise to simply
add a field to the chat history for the git commit hash, but for now I avoid
this as implementing it this way involves modifying some seemingly core
functionalities (in the logger class).

## Basic usage examples:

    ... vibes ...
    > /chat-git save my_checkpoint
    ... more vibes ...
    > /chat-git save feature_x_01
    ... vibes break ...
    > /chat-git resume feature_x_01
    ... get emergency call to patch ...
    > /chat-git resume my_checkpoint
    ... work on fix ...
    > /chat-git save bug_fix_01
    ... finish bug fix
    > /chat-git save bug_fix_02
    > /chat-git delete bug_fix_01
