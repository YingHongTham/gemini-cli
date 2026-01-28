///**
// * @license
// * Copyright 2025 Google LLC
// * SPDX-License-Identifier: Apache-2.0
// */
//
//import * as fs from 'node:fs/promises';
//import * as path from 'node:path';
//import { isNodeError } from '../utils/errors.js';
//import { spawnAsync } from '../utils/shell-utils.js';
//import type { SimpleGit } from 'simple-git';
//import { simpleGit, CheckRepoActions } from 'simple-git';
//import type { Storage } from '../config/storage.js';
//import { debugLogger } from '../utils/debugLogger.js';
//
//export class GitService {
//  private projectRoot: string;
//  //private storage: Storage;
//
//  //constructor(projectRoot: string, storage: Storage) {
//  constructor(projectRoot?: string) {
//    this.projectRoot = projectRoot;
//    // ^further processed in setupProjectGitRepository, after checking git stuff
//    // if already git repo, then reset this.projectRoot to actual root
//    //this.projectRoot = (typeof projectRoot !== 'undefined') ? path.resolve(projectRoot) : null;
//    //this.storage = storage;
//  }
//
//  async initialize(): Promise<void> {
//    const gitAvailable = await GitService.verifyGitAvailability();
//    if (!gitAvailable) {
//      throw new Error(
//        'Checkpointing is enabled, but Git is not installed. Please install Git or disable checkpointing to continue.',
//      );
//    }
//    try {
//      await this.setupProjectGitRepository();
//    } catch (error) {
//      throw new Error(
//        `Failed to initialize checkpointing: ${error instanceof Error ? error.message : 'Unknown error'}. Please check that Git is working properly or disable checkpointing.`,
//      );
//    }
//  }
//
//  static async verifyGitAvailability(): Promise<boolean> {
//    try {
//      await spawnAsync('git', ['--version']);
//      return true;
//    } catch (_error) {
//      return false;
//    }
//  }
//
//  statis async verifyCwdIsGitRepo(): Promise<boolean> {
//    const git = simpleGit();
//    return git.checkIsRepo();
//  }
//
//  /**
//   * Creates a hidden git repository in the project root.
//   * The Git repository is used to support checkpointing.
//   */
//  async setupProjectGitRepository() {
//    //this.projectRoot = () ? path.resolve(projectRoot) : null;
//    const cwd = process.cwd();
//    let isProjectRootSpecified = (typeof projectRoot !== 'undefined');
//    this.projectRoot = isProjectRootSpecified ? path.resolve(this.projectRoot) : cwd;
//    // in false case, this.projectRoot is reset after checking that cwd is in git repot
//    const repo = simpleGit(this.projectRoot);
//    let isRepoDefined = false;
//    try {
//      //isRepoDefined = await repo.checkIsRepo(CheckRepoActions.IS_REPO_ROOT);
//      isRepoDefined = await repo.checkIsRepo(); // doesn't need to be at project root
//    } catch (error) {
//      // If checkIsRepo fails (e.g., on certain Git versions like macOS 2.39.5),
//      // log the error and assume repo is not defined, then proceed with initialization
//      debugLogger.debug(
//        `checkIsRepo failed, will initialize repository: ${error instanceof Error ? error.message : String(error)}`,
//      );
//    }
//
//    if (!isRepoDefined) {
//      if (!isProjectRootSpecified) {
//        throw new Error(
//          'If no project root is given, current working directory must be in a git repo.',
//        );
//      }
//      await repo.init(false, {
//        '--initial-branch': 'main',
//      });
//
//      await repo.commit('Initial commit', { '--allow-empty': null });
//    }
//    else {
//      this.projectRoot = repo.revparse(['--show-toplevel']);
//    }
//
//    const userGitIgnorePath = path.join(this.projectRoot, '.gitignore');
//
//    let userGitIgnoreContent = '';
//    try {
//      userGitIgnoreContent = await fs.readFile(userGitIgnorePath, 'utf-8');
//    } catch (error) {
//      if (isNodeError(error) && error.code !== 'ENOENT') {
//        throw error;
//      }
//    }
//
//    await fs.writeFile(userGitIgnorePath, userGitIgnoreContent);
//  }
//
//  private get projectGitRepository(): SimpleGit {
//    return simpleGit(this.projectRoot).env({
//      GIT_DIR: path.join(this.projectRoot, '.git'),
//      GIT_WORK_TREE: this.projectRoot,
//      // Prevent git from using the user's global git config.
//      HOME: this.projectRoot,
//      XDG_CONFIG_HOME: this.projectRoot,
//    });
//  }
//
//  async getCurrentCommitHash(): Promise<string> {
//    const hash = await this.projectGitRepository.raw('rev-parse', 'HEAD');
//    return hash.trim();
//  }
//
//  async createFileSnapshot(message: string): Promise<string> {
//    try {
//      const repo = this.shadowGitRepository;
//      await repo.add('.');
//      const status = await repo.status();
//      if (status.isClean()) {
//        // If no changes are staged, return the current HEAD commit hash
//        return await this.getCurrentCommitHash();
//      }
//      const commitResult = await repo.commit(message, {
//        '--no-verify': null,
//      });
//      return commitResult.commit;
//    } catch (error) {
//      throw new Error(
//        `Failed to create checkpoint snapshot: ${error instanceof Error ? error.message : 'Unknown error'}. Checkpointing may not be working properly.`,
//      );
//    }
//  }
//
//  async restoreProjectFromSnapshot(commitHash: string): Promise<void> {
//    const repo = this.shadowGitRepository;
//    await repo.raw(['restore', '--source', commitHash, '.']);
//    // Removes any untracked files that were introduced post snapshot.
//    await repo.clean('f', ['-d']);
//  }
//}
