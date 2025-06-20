import dotenv from 'dotenv';
dotenv.config();

import YomiageBot from './bot.js';
import { createConfig } from './config.js';

const config = createConfig();
const bot = new YomiageBot(config);

bot.start().catch(console.error); 