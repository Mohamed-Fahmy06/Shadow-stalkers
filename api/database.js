import fs from 'fs';
import path from 'path';
import bcrypt from 'bcryptjs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const env = process.env || {};
const dbPath = env.VERCEL ? '/tmp/db.json' : path.resolve(__dirname, 'db.json');

// Memory Storage
let data = {
    Roles: [],
    Users: [],
    Rooms: [],
    Time_Slots: [],
    Bookings: [],
    Delegations: []
};

// Persistence Helpers
const saveData = () => {
    try {
        fs.writeFileSync(dbPath, JSON.stringify(data, null, 2));
    } catch (e) {
        console.error('Failed to save data:', e);
    }
};

const loadData = () => {
    try {
        if (fs.existsSync(dbPath)) {
            const raw = fs.readFileSync(dbPath);
            data = JSON.parse(raw);
        }
    } catch (e) {
        console.error('Failed to load data:', e);
    }
};

// SQLite-like API Wrapper
export const db = {
    get: (sql, params, callback) => {
        try {
            // Very simple "SQL" parser for common lookups
            if (sql.includes('FROM Users') && sql.includes('User_ID = ?')) {
                const user = data.Users.find(u => u.User_ID == params[0]);
                if (user) {
                    const role = data.Roles.find(r => r.Role_ID == user.Role_ID);
                    callback(null, { ...user, Role_Name: role ? role.Role_Name : '' });
                } else {
                    callback(null, null);
                }
            } else if (sql.includes('FROM Rooms')) {
                const room = data.Rooms.find(r => r.Room_ID == params[0]);
                callback(null, room);
            } else if (sql.includes('FROM Time_Slots')) {
                const slot = data.Time_Slots.find(s => s.Slot_ID == params[0]);
                callback(null, slot);
            } else if (sql.includes('FROM Bookings')) {
                const booking = data.Bookings.find(b => b.Booking_ID == params[0]);
                callback(null, booking);
            } else {
                callback(null, null);
            }
        } catch (e) { callback(e); }
    },
    all: (sql, params, callback) => {
        try {
            if (typeof params === 'function') { callback = params; params = []; }
            
            if (sql.includes('FROM Bookings')) {
                // Return all bookings with joined data
                const result = data.Bookings.map(b => {
                    const room = data.Rooms.find(r => r.Room_ID == b.Room_ID);
                    const slot = data.Time_Slots.find(s => s.Slot_ID == b.Slot_ID);
                    const user = data.Users.find(u => u.User_ID == b.User_ID);
                    return {
                        ...b,
                        Room_Name: room ? room.Room_Name : '',
                        Room_Type: room ? room.Room_Type : '',
                        Start_Time: slot ? slot.Start_Time : '',
                        End_Time: slot ? slot.End_Time : '',
                        Full_Name: user ? user.Full_Name : ''
                    };
                });
                
                // Filtering if needed (for my-requests or reports)
                if (sql.includes('User_ID = ?')) {
                    callback(null, result.filter(r => r.User_ID == params[0]));
                } else if (sql.includes('Booking_Date = ?')) {
                    callback(null, result.filter(r => r.Booking_Date == params[0]));
                } else {
                    callback(null, result);
                }
            } else if (sql.includes('FROM Rooms')) {
                callback(null, data.Rooms);
            } else if (sql.includes('FROM Time_Slots')) {
                callback(null, data.Time_Slots);
            } else {
                callback(null, []);
            }
        } catch (e) { callback(e); }
    },
    run: function(sql, params, callback) {
        try {
            if (typeof params === 'function') { callback = params; params = []; }
            
            if (sql.includes('INSERT INTO Bookings')) {
                const newId = data.Bookings.length + 1;
                data.Bookings.push({
                    Booking_ID: newId,
                    User_ID: params[0], Room_ID: params[1], Booking_Date: params[2],
                    Slot_ID: params[3], Booking_Type: params[4], Purpose: params[5],
                    Req_Laptops: params[6], Req_Microphones: params[7], Req_VideoConf: params[8],
                    Status: 'Pending'
                });
                saveData();
                if (callback) callback.call({ lastID: newId }, null);
            } else if (sql.includes('UPDATE Bookings')) {
                const booking = data.Bookings.find(b => b.Booking_ID == params[3]);
                if (booking) {
                    booking.Status = params[0];
                    booking.Rejection_Reason = params[1];
                    booking.Alternative_Suggestion = params[2];
                    saveData();
                }
                if (callback) callback(null);
            } else if (sql.includes('INSERT INTO Delegations')) {
                data.Delegations.push({
                    Original_User_ID: params[0], Substitute_User_ID: params[1],
                    Start_Date: params[2], End_Date: params[3]
                });
                saveData();
                if (callback) callback(null);
            } else {
                if (callback) callback(null);
            }
        } catch (e) { if (callback) callback(e); }
    }
};

export const initDb = async () => {
    loadData();
    if (data.Roles.length > 0) return db;

    // Seed Data
    data.Roles = [
        { Role_ID: 1, Role_Name: 'Admin' },
        { Role_ID: 2, Role_Name: 'Branch Manager' },
        { Role_ID: 3, Role_Name: 'Employee' },
        { Role_ID: 4, Role_Name: 'Secretary' }
    ];

    const hashes = {
        admin: await bcrypt.hash('admin123', 10),
        mngr: await bcrypt.hash('mngr', 10),
        emp: await bcrypt.hash('emp', 10),
        sec: await bcrypt.hash('sec', 10)
    };

    data.Users = [
        { User_ID: 100, Full_Name: 'System Admin', Password_Hash: hashes.admin, Role_ID: 1 },
        { User_ID: 200, Full_Name: 'Branch Manager', Password_Hash: hashes.mngr, Role_ID: 2 },
        { User_ID: 300, Full_Name: 'Employee', Password_Hash: hashes.emp, Role_ID: 3 },
        { User_ID: 400, Full_Name: 'College Secretary', Password_Hash: hashes.sec, Role_ID: 4 }
    ];

    data.Rooms = [
        { Room_ID: 1, Room_Name: 'Hall A', Room_Type: 'Lecture Hall', Capacity: 150 },
        { Room_ID: 2, Room_Name: 'Hall B', Room_Type: 'Lecture Hall', Capacity: 100 },
        { Room_ID: 3, Room_Name: 'Meeting Room 1', Room_Type: 'Multi-purpose', Capacity: 30 },
        { Room_ID: 4, Room_Name: 'Conference Center', Room_Type: 'Multi-purpose', Capacity: 500 }
    ];

    data.Time_Slots = [
        { Slot_ID: 1, Start_Time: '08:00', End_Time: '10:00' },
        { Slot_ID: 2, Start_Time: '10:00', End_Time: '12:00' },
        { Slot_ID: 3, Start_Time: '12:00', End_Time: '14:00' },
        { Slot_ID: 4, Start_Time: '14:00', End_Time: '16:00' }
    ];

    saveData();
    return db;
};
