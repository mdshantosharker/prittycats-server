const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const { createRemoteJWKSet, jwtVerify } = require("jose-cjs");
dotenv.config();
const app = express();
const port = process.env.PORT;

app.use(cors());
app.use(express.json());

const uri = process.env.PRITTYCATS_DB;
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

const JWKS = createRemoteJWKSet(
  new URL(`${process.env.CLIENT_URL}/api/auth/jwks`),
);

const verifyToken = async (req, res, next) => {
  const authHeader = req?.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({
      message: "Unauthorized",
    });
  }
  const token = authHeader.split(" ")[1];
  if (!token) {
    return res.status(401).json({
      message: "Unauthorized",
    });
  }

  try {
    const { payload } = await jwtVerify(token, JWKS);
    req.user = payload;
    console.log(payload);
    next();
  } catch (error) {
    return res.status(403).json({
      message: "Forbidden",
    });
  }
};

async function run() {
  try {
    // await client.connect();
    const prittycatsDB = client.db("prittycats");
    const prittycatsCollection = prittycatsDB.collection("pets");
    const adoptedCollection = prittycatsDB.collection("adopted");

    app.get("/adopted/:petId", async (req, res) => {
      const { petId } = req.params;
      const result = await adoptedCollection.find({ petId }).toArray();
      res.send(result);
    });

    app.get("/adopted/:petId/:userId", async (req, res) => {
      const { petId, userId } = req.params;
      const result = await adoptedCollection.findOne({
        petId,
        userId,
      });

      res.send(result);
    });

    app.delete("/adopted/:id", async (req, res) => {
      const { id } = req.params;
      const result = await adoptedCollection.deleteOne({
        _id: new ObjectId(id),
      });
      res.send(result);
    });

    app.delete("/pets/:id", async (req, res) => {
      const { id } = req.params;
      const result = await prittycatsCollection.deleteOne({
        _id: new ObjectId(id),
      });
      res.send(result);
    });

    app.patch("/adopted/:id", async (req, res) => {
      const { id } = req.params;
      const { status } = req.body;

      const request = await adoptedCollection.findOne({
        _id: new ObjectId(id),
      });

      if (!request) {
        return res.status(404).send({ message: "Not found" });
      }
      if (status === "approved") {
        await adoptedCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { status } },
        );
        await adoptedCollection.updateMany(
          {
            petId: request.petId,
            _id: { $ne: new ObjectId(id) },
          },
          {
            $set: { status: "rejected" },
          },
        );
        await prittycatsCollection.updateOne(
          { _id: new ObjectId(request.petId) },
          {
            $set: {
              adopted: true,
              adoptionStatus: "closed",
            },
          },
        );

        return res.send({
          success: true,
          message: "Pet locked permanently",
        });
      }
      await adoptedCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { status } },
      );

      res.send({ success: true });
    });

    app.post("/adopted", verifyToken, async (req, res) => {
      const { userId, petId } = req.body;
      const pet = await prittycatsCollection.findOne({
        _id: new ObjectId(petId),
      });
      if (pet?.adoptionStatus === "closed" || pet?.adopted) {
        return res.status(400).send({
          message: "Pet is closed for adoption",
          alreadyAdopted: true,
        });
      }
      const existing = await adoptedCollection.findOne({ userId, petId });
      if (existing) {
        return res.send({
          alreadyExists: true,
          data: existing,
        });
      }
      const result = await adoptedCollection.insertOne({
        ...req.body,
        status: "pending",
      });

      res.send({
        success: true,
        insertedId: result.insertedId,
      });
    });

    app.get("/adopted", async (req, res) => {
      const { ownerEmail, userId } = req.query;
      let query = {};
      if (ownerEmail) {
        query.ownerEmail = ownerEmail;
      }

      if (userId) {
        query.userId = userId;
      }

      const result = await adoptedCollection.find(query).toArray();
      res.send(result);
    });

    app.get("/adopted-details/:id", async (req, res) => {
      const { id } = req.params;
      const result = await adoptedCollection.findOne({
        _id: new ObjectId(id),
      });
      res.send(result);
    });

    app.get("/pets/:id", verifyToken, async (req, res) => {
      const { id } = req.params;
      const result = await prittycatsCollection.findOne({
        _id: new ObjectId(id),
      });
      res.send(result);
    });

    app.patch("/pets/:id", verifyToken, async (req, res) => {
      const { id } = req.params;
      const updateData = req.body;
      const result = await prittycatsCollection.updateOne(
        {
          _id: new ObjectId(id),
        },
        {
          $set: updateData,
        },
      );
      res.send(result);
    });

    app.get("/pets", async (req, res) => {
      const { search = "", species } = req.query;
      const query = {};
      if (search) {
        query.name = {
          $regex: search,
          $options: "i",
        };
      }
      if (species) {
        const speciesArray = species.split(",");
        query.species = {
          $in: speciesArray,
        };
      }
      const result = await prittycatsCollection.find(query).toArray();
      res.send(result);
    });

    app.get("/my-pets", verifyToken, async (req, res) => {
      const { search = "", species, ownerEmail } = req.query;
      const query = {};
      if (ownerEmail) {
        query.ownerEmail = ownerEmail;
      }
      const result = await prittycatsCollection.find(query).toArray();
      res.send(result);
    });

    app.post("/pets", verifyToken, async (req, res) => {
      const pet = req.body;
      const fixedPet = {
        ...pet,
        adopted: false,
        _id: new ObjectId(pet._id),
      };
      const result = await prittycatsCollection.insertOne(fixedPet);
      res.send({
        insertedId: fixedPet._id,
        success: true,
      });
    });

    // await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!",
    );
  } finally {
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Hello World!");
});

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
