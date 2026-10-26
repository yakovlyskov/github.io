import { integer, sqliteTable, text, primaryKey, uniqueIndex } from 'drizzle-orm/sqlite-core';
export const rooms=sqliteTable('rooms',{
 code:text('code').primaryKey(), title:text('title').notNull(), hostHash:text('host_hash').notNull(),
 deck:text('deck').notNull(), current:integer('current').notNull().default(-1), phase:text('phase').notNull().default('lobby'),
 revision:integer('revision').notNull().default(0), mutation:text('mutation').notNull().default(''), context:text('context').notNull().default(''),
 joinLocked:integer('join_locked').notNull().default(0), created:integer('created').notNull(), ended:integer('ended')
});
export const players=sqliteTable('players',{
 id:text('id').primaryKey(), room:text('room').notNull().references(()=>rooms.code), name:text('name').notNull(),
 tokenHash:text('token_hash').notNull(), joined:integer('joined').notNull(), seen:integer('seen').notNull()
},t=>[uniqueIndex('unique_player_name').on(t.room,t.name)]);
export const answers=sqliteTable('answers',{
 room:text('room').notNull().references(()=>rooms.code), player:text('player').notNull().references(()=>players.id),
 round:integer('round').notNull(), choice:integer('choice'), text:text('text').notNull().default(''), ref:text('ref').notNull().default(''),
 blocked:integer('blocked').notNull().default(0), confidence:integer('confidence').notNull().default(2),
 updated:integer('updated').notNull(), submitted:integer('submitted'), score:integer('score'), feedback:text('feedback').notNull().default('')
},t=>[primaryKey({columns:[t.room,t.player,t.round]})]);
export const rounds=sqliteTable('rounds',{
 room:text('room').notNull().references(()=>rooms.code), idx:integer('idx').notNull(), opened:integer('opened').notNull(),
 deadline:integer('deadline'), closed:integer('closed'), revealed:integer('revealed'), teamRef:text('team_ref').notNull().default(''),
 teamDone:integer('team_done').notNull().default(0)
},t=>[primaryKey({columns:[t.room,t.idx]})]);
export const events=sqliteTable('events',{
 id:integer('id').primaryKey({autoIncrement:true}), room:text('room').notNull().references(()=>rooms.code),
 actor:text('actor').notNull(), action:text('action').notNull(), round:integer('round').notNull(), at:integer('at').notNull()
});
export const limits=sqliteTable('limits',{key:text('key').primaryKey(),count:integer('count').notNull().default(0)});
