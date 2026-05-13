/**
 * Conflict Resolution Logic
 * Priority: Server timestamp wins if newer, otherwise local wins
 */
exports.resolveSyncConflict = (localRecord, serverRecord) => {
    if (!serverRecord) return localRecord; // New record, no conflict
    
    const localTime = new Date(localRecord.scanTime).getTime();
    const serverTime = new Date(serverRecord.updatedAt).getTime();

    return localTime > serverTime ? localRecord : serverRecord;
};