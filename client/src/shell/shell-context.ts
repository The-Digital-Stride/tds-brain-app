import { createContext } from 'react';
import type { ShellApi } from './contract.ts';

/**
 * What `ShellProvider` provides, in a module of its own so a hook can read it without importing the provider (tests
 * often mock `ShellProvider.tsx` whole). Null outside a ShellProvider.
 */
export const ShellContext = createContext<ShellApi | null>(null);
