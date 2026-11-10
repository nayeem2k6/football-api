import mongoose from "mongoose";

export async function connectToDatabase(uri: string): Promise<void> {
  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 10_000,
  });
  console.log("Connected to MongoDB");
}

export function isDatabaseConnected(): boolean {
  return mongoose.connection.readyState === 1;
}

mongoose.connection.on("disconnected", () => {
  console.error("MongoDB connection was lost");
});

mongoose.connection.on("error", (error: Error) => {
  console.error("MongoDB connection error", error);
});
