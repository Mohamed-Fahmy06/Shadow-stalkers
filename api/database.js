import fs from 'fs';
import path from 'path';
import bcrypt from 'bcryptjs';
import { fileURLToPath } from 'url';
import initSqlJs from 'sql.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const env = process.env || {};
const dbPath = env.VERCEL ? '/tmp/booking_system.db' : path.resolve(__dirname, 'booking_system.db');

let SQL = null;
let db = null;
let initialized = false;
let initPromise = null;

// Mock the sqlite3 interface using sql.js for minimal changes to index.js
const dbInterface = {
    get: (sql, params, callback) => {
        try {
            const stmt = db.prepare(sql);
            stmt.bind(params);
            const result = stmt.step() ? stmt.getAsObject() : null;
            stmt.free();
            callback(null, result);
        } catch (err) {
            callback(err);
        }
    },
    all: (sql, params, callback) => {
        try {
            // Handle optional params
            if (typeof params === 'function') {
                callback = params;
                params = [];
            }
            const stmt = db.prepare(sql);
            stmt.bind(params);
            const rows = [];
            while (stmt.step()) rows.push(stmt.getAsObject());
            stmt.free();
            callback(null, rows);
        } catch (err) {
            callback(err);
        }
    },
    run: function(sql, params, callback) {
        try {
            // Handle optional params
            if (typeof params === 'function') {
                callback = params;
                params = [];
            }
            db.run(sql, params);
            // Save to disk after every write for persistence on Vercel
            const data = db.export();
            const buffer = Buffer.from(data);
            fs.writeFileSync(dbPath, buffer);
            
            if (callback) callback.call({ lastID: 0 }, null);
        } catch (err) {
            if (callback) callback(err);
        }
    }
};

const doInit = async () => {
    console.log('Starting Pure JS SQL Init at:', dbPath);
    SQL = await initSqlJs();
    
    if (fs.existsSync(dbPath)) {
        const fileBuffer = fs.readFileSync(dbPath);
        db = new SQL.Database(fileBuffer);
        console.log('Database loaded from disk');
    } else {
        db = new SQL.Database();
        console.log('New in-memory database created');
    }

    const runAction = (sql, params = []) => {
        db.run(sql, params);
    };

    runAction(`CREATE TABLE IF NOT EXISTS Roles (Role_ID INTEGER PRIMARY KEY AUTOINCREMENT, Role_Name TEXT UNIQUE NOT NULL)`);
    runAction(`CREATE TABLE IF NOT EXISTS Users (User_ID INTEGER PRIMARY KEY, Full_Name TEXT NOT NULL, Password_Hash TEXT NOT NULL, Role_ID INTEGER, View_Available_Override BOOLEAN DEFAULT 0, FOREIGN KEY (Role_ID) REFERENCES Roles(Role_ID))`);
    runAction(`CREATE TABLE IF NOT EXISTS Rooms (Room_ID INTEGER PRIMARY KEY AUTOINCREMENT, Room_Name TEXT NOT NULL, Room_Type TEXT NOT NULL CHECK(Room_Type IN ('Lecture Hall', 'Multi-purpose')), Capacity INTEGER NOT NULL)`);
    runAction(`CREATE TABLE IF NOT EXISTS Time_Slots (Slot_ID INTEGER PRIMARY KEY AUTOINCREMENT, Start_Time TEXT NOT NULL, End_Time TEXT NOT NULL, Is_Ramadan_Schedule BOOLEAN DEFAULT 0)`);
    runAction(`CREATE TABLE IF NOT EXISTS Bookings (Booking_ID INTEGER PRIMARY KEY AUTOINCREMENT, User_ID INTEGER NOT NULL, Room_ID INTEGER NOT NULL, Booking_Date TEXT NOT NULL, Slot_ID INTEGER NOT NULL, Booking_Type TEXT NOT NULL CHECK(Booking_Type IN ('Static', 'Exceptional', 'Multi-purpose')), Status TEXT NOT NULL DEFAULT 'Pending' CHECK(Status IN ('Pending', 'Approved', 'Rejected')), Purpose TEXT, Req_Laptops INTEGER DEFAULT 0, Req_Microphones INTEGER DEFAULT 0, Req_VideoConf BOOLEAN DEFAULT 0, Rejection_Reason TEXT, Alternative_Suggestion TEXT, FOREIGN KEY (User_ID) REFERENCES Users(User_ID), FOREIGN KEY (Room_ID) REFERENCES Rooms(Room_ID), FOREIGN KEY (Slot_ID) REFERENCES Time_Slots(Slot_ID))`);
    runAction(`CREATE TABLE IF NOT EXISTS Delegations (Delegate_ID INTEGER PRIMARY KEY AUTOINCREMENT, Original_User_ID INTEGER NOT NULL, Substitute_User_ID INTEGER NOT NULL, Start_Date TEXT NOT NULL, End_Date TEXT NOT NULL, FOREIGN KEY (Original_User_ID) REFERENCES Users(User_ID), FOREIGN KEY (Substitute_User_ID) REFERENCES Users(User_ID))`);

    const roles = ['Admin', 'Branch Manager', 'Employee', 'Secretary'];
    for (const role of roles) {
        db.run(`INSERT OR IGNORE INTO Roles (Role_Name) VALUES (?)`, [role]);
    }

    const adminHash = await bcrypt.hash('admin123', 10);
    const mngrHash = await bcrypt.hash('mngr', 10);
    const empHash = await bcrypt.hash('emp', 10);
    const secHash = await bcrypt.hash('sec', 10);

    db.run(`INSERT OR REPLACE INTO Users (User_ID, Full_Name, Password_Hash, Role_ID, View_Available_Override) VALUES (?, ?, ?, 1, ?)`, [100, 'System Admin', adminHash, 1]);
    db.run(`INSERT OR REPLACE INTO Users (User_ID, Full_Name, Password_Hash, Role_ID) VALUES (200, 'Branch Manager', ?, 2)`, [mngrHash]);
    db.run(`INSERT OR REPLACE INTO Users (User_ID, Full_Name, Password_Hash, Role_ID) VALUES (300, 'Employee', ?, 3)`, [empHash]);
    db.run(`INSERT OR REPLACE INTO Users (User_ID, Full_Name, Password_Hash, Role_ID) VALUES (400, 'College Secretary', ?, 4)`, [secHash]);

    db.run(`INSERT OR IGNORE INTO Rooms (Room_ID, Room_Name, Room_Type, Capacity) VALUES (1, 'Hall A', 'Lecture Hall', 150)`);
    db.run(`INSERT OR IGNORE INTO Rooms (Room_ID, Room_Name, Room_Type, Capacity) VALUES (2, 'Hall B', 'Lecture Hall', 100)`);
    db.run(`INSERT OR IGNORE INTO Rooms (Room_ID, Room_Name, Room_Type, Capacity) VALUES (3, 'Meeting Room 1', 'Multi-purpose', 30)`);
    db.run(`INSERT OR IGNORE INTO Rooms (Room_ID, Room_Name, Room_Type, Capacity) VALUES (4, 'Conference Center', 'Multi-purpose', 500)`);

    db.run(`INSERT OR IGNORE INTO Time_Slots (Slot_ID, Start_Time, End_Time) VALUES (1, '08:00', '10:00')`);
    db.run(`INSERT OR IGNORE INTO Time_Slots (Slot_ID, Start_Time, End_Time) VALUES (2, '10:00', '12:00')`);
    db.run(`INSERT OR IGNORE INTO Time_Slots (Slot_ID, Start_Time, End_Time) VALUES (3, '12:00', '14:00')`);
    db.run(`INSERT OR IGNORE INTO Time_Slots (Slot_ID, Start_Time, End_Time) VALUES (4, '14:00', '16:00')`);

    // Initial save
    const data = db.export();
    fs.writeFileSync(dbPath, Buffer.from(data));
    console.log('Database initialization complete');
};

export const initDb = async () => {
    if (initialized) return dbInterface;
    if (!initPromise) initPromise = doInit().then(() => { initialized = true; });
    await initPromise;
    return dbInterface;
};

export const db = dbInterface;
