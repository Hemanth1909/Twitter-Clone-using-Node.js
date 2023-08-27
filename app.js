const express = require("express");
const path = require("path");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const { open } = require("sqlite");
const sqlite3 = require("sqlite3");
const app = express();

const dbPath = path.join(__dirname, "twitterClone.db");
app.use(express.json());

let db = null;

const authenticateToken = (request, response, next) => {
  const { tweet } = request.body;
  const { tweetId } = request.params;
  let jwtToken;
  const authHeader = request.headers["authorization"];
  if (authHeader !== undefined) {
    jwtToken = authHeader.split(" ")[1];
  }
  if (jwtToken === undefined) {
    response.status(401);
    response.send("Invalid JWT Token");
  } else {
    jwt.verify(jwtToken, "MY_SECRET_TOKEN", async (error, payload) => {
      if (error) {
        response.status(401);
        response.send("Invalid JWT Token");
      } else {
        request.payload = payload;
        request.tweet = tweet;
        request.tweetId = tweetId;
        next();
      }
    });
  }
};

const initializeDBAndServer = async () => {
  try {
    db = await open({
      filename: dbPath,
      driver: sqlite3.Database,
    });
    app.listen(3000, () => {
      console.log("Server Running at http://localhost:3000/");
    });
  } catch (e) {
    console.log(`DB Error: ${e.message}`);
    process.exit(1);
  }
};

initializeDBAndServer();

//API-1 => Register the user

app.post("/register/", async (request, response) => {
  const { username, password, name, gender } = request.body;
  console.log(password);

  const getUserQuery = `SELECT * FROM user WHERE username = '${username}';`;
  const dbUser = await db.get(getUserQuery);

  //checking the user is already exists or not
  if (dbUser === undefined) {
    const passwordLength = password.length;
    //checking the length of the password
    if (password.length < 6) {
      response.status(400);
      response.send("Password is too short");
    } else {
      const hashedPassword = await bcrypt.hash(password, 10);
      const registerUserQuery = `
        INSERT INTO user
        (name, username, password, gender)
        VALUES('${name}', '${username}', '${hashedPassword}', '${gender}');`;

      await db.run(registerUserQuery);
      response.status(200);
      response.send("User created successfully");
    }
  }
  //If user is already exists sending the bad request
  else {
    response.status(400);
    response.send("User already exists");
  }
});

//API-2 => login of the user
app.post("/login/", async (request, response) => {
  const { username, password } = request.body;

  //getting the user data from the database
  const getUserQuery = `
        SELECT * FROM user WHERE username = '${username}';`;
  const databaseUser = await db.get(getUserQuery);

  //checking the user is exists or not
  if (databaseUser === undefined) {
    response.status(400);
    response.send("Invalid user");
  } else {
    const isPasswordMatched = await bcrypt.compare(
      password,
      databaseUser.password
    );
    //checking the password
    if (isPasswordMatched === true) {
      const jwtToken = jwt.sign(databaseUser, "MY_SECRET_TOKEN");
      response.send({ jwtToken });
    } else {
      response.status(400);
      response.send("Invalid password");
    }
  }
});

//API-3 => return the tweets of the user

app.get("/user/tweets/feed/", authenticateToken, async (request, response) => {
  const { payload } = request;
  const { user_id, name, username, gender } = payload;

  const getTweetFeedsQuery = `
    SELECT 
    username,
    tweet,
    date_time AS dateTime
    FROM
    follower INNER JOIN tweet ON follower.following_user_id = tweet.user_id INNER JOIN user ON user.user_id = follower.following_user_id
    WHERE follower.follower_user_id = ${user_id}
    ORDER BY 
    date_time DESC
    LIMIT 4;`;
  const tweetsFeed = await db.all(getTweetFeedsQuery);
  response.send(tweetsFeed);
});

//API-4 => Returns the list of all names of people whom the user follows

app.get("/user/following/", authenticateToken, async (request, response) => {
  const { payload } = request;
  console.log(payload);
  const { user_id, name, username, gender } = payload;

  const userFollowerQuery = `
    SELECT
        name
    FROM
        user INNER JOIN follower ON user.user_id = follower.following_user_id
    WHERE
        follower.follower_user_id = ${user_id};`;
  const followingUsersArray = await db.all(userFollowerQuery);
  response.send(followingUsersArray);
});

//API-5 => Returns the list of all names of people who follows the user

app.get("/user/followers/", authenticateToken, async (request, response) => {
  const { payload } = request;
  const { user_id, name, username, gender } = payload;

  const userFollowerArray = `
    SELECT
        name
    FROM
        user INNER JOIN follower ON user.user_id = follower.follower_user_id
    WHERE
        follower.following_user_id = ${user_id};`;
  const followersArray = await db.all(userFollowerArray);
  response.send(followersArray);
});

//API-6 => Returns the tweets based on the tweet id
app.get("/tweets/:tweetId/", authenticateToken, async (request, response) => {
  const { tweetId } = request;
  const { payload } = request;
  const { user_id, name, username, gender } = payload;

  const tweetsQuery = `
    SELECT * FROM tweet WHERE tweet_id = ${tweetId};`;

  const allTweets = await db.get(tweetsQuery);
  //************************************ */
  const userFollowerQuery = `
    SELECT *
    FROM
    follower INNER JOIN user ON user.user_id = follower.following_user_id
    WHERE
    follower.follower_user_id = ${user_id};`;

  const userFollowers = await db.all(userFollowerQuery);
  if (
    userFollowers.some((item) => item.following_user_id === allTweets.user_id)
  ) {
    const getTweetDetailsQuery = `
            SELECT
                tweet,
                COUNT(DISTINCT(like.like_id)) AS likes,
                COUNT(DISTINCT(reply.reply_id)) AS replies,
                tweet.date_time AS dateTime
            FROM
                tweet INNER JOIN like ON tweet.tweet_id = like.tweet_id INNER JOIN reply ON reply.tweet_id = tweet.tweet_id
            WHERE
                tweet.tweet_id = ${tweetId} AND tweet.user_id = ${userFollowers[0].user_id};`;
    const tweetDetails = await db.get(getTweetDetailsQuery);
    response.send(tweetDetails);
  } else {
    response.status(401);
    response.send("Invalid Request");
  }
});

//API-7 => return tweet liked users

app.get(
  "/tweets/:tweetId/likes/",
  authenticateToken,
  async (request, response) => {
    const { tweetId } = request;
    const { payload } = request;
    const { user_id, name, username, gender } = payload;

    const getLikedUserQuery = `
        SELECT
        *
        FROM
        follower INNER JOIN tweet ON tweet.user_id = follower.following_user_id INNER JOIN like ON like.tweet_id = tweet.tweet_id INNER JOIN user ON user.user_id = like.user_id
        WHERE
        tweet.tweet_id = ${tweetId} AND follower.follower_user_id = ${user_id};`;
    const likedUsers = await db.all(getLikedUserQuery);
    if (likedUsers.length !== 0) {
      let likes = [];
      const getNamesArray = (likedUsers) => {
        for (let item of likedUsers) {
          likes.push(item.username);
        }
      };
      getNamesArray(likedUsers);
      response.send({ likes });
    } else {
      response.status(401);
      response.send("Invalid Request");
    }
  }
);

//API-8
app.get(
  "/tweets/:tweetId/replies/",
  authenticateToken,
  async (request, response) => {
    const { tweetId } = request;
    const { payload } = request;
    const { user_id, name, username, gender } = payload;

    const getRepliedUserQuery = `
        SELECT 
        *
        FROM
        follower INNER JOIN tweet ON tweet.user_id = follower.following_user_id INNER JOIN reply ON reply.tweet_id = tweet.tweet_id INNER JOIN user ON user.user_id = reply.user_id
        WHERE
        tweet.tweet_id = ${tweetId} AND follower.follower_user_id = ${user_id};`;

    const repliedUser = await db.all(getRepliedUserQuery);
    if (repliedUser.length !== 0) {
      let replies = [];
      const getNamesArray = (repliedUser) => {
        for (let item of repliedUser) {
          let object = {
            name: item.name,
            reply: item.reply,
          };
          replies.push(object);
        }
      };
      getNamesArray(repliedUser);
      response.send({ replies });
    } else {
      response.status(401);
      response.send("Invalid Request");
    }
  }
);

//API-9 => Returns all the tweets of the user

app.get("/user/tweets/", authenticateToken, async (request, response) => {
  const { payload } = request;
  const { user_id, name, username, gender } = payload;

  const getTweetDetailsQuery = `
        SELECT 
        tweet.tweet AS tweet,
        COUNT(DISTINCT(like.like_id)) AS likes,
        COUNT(DISTINCT(reply.reply_id)) AS replies,
        tweet.date_time AS dateTime
        FROM
        user INNER JOIN tweet ON user.user_id = tweet.user_id INNER JOIN like ON like.tweet_id = tweet.tweet_id INNER JOIN reply ON reply.tweet_id = tweet.tweet_id
        WHERE
        user.user_id = ${user_id}
        GROUP BY
        tweet.tweet_id;`;
  const tweetDetails = await db.all(getTweetDetailsQuery);
  response.send(tweetDetails);
});

//API-10 => get post tweet

app.post("/user/tweets/", authenticateToken, async (request, response) => {
  const { tweet } = request;
  const { tweetId } = request;
  const { payload } = request;
  const { user_id, name, username, gender } = payload;

  const postTweetQuery = `
    INSERT INTO
    tweet(tweet, user_id)
    VALUES('${tweet}', ${user_id});`;

  await db.run(postTweetQuery);
  response.send("Created a Tweet");
});

//API-11 => Deleting the tweet

app.delete(
  "/tweets/:tweetId/",
  authenticateToken,
  async (request, response) => {
    const { tweetId } = request;
    const { tweet } = request;
    const { payload } = request;

    const { user_id, name, username, gender } = payload;
    const selectUseQuery = `
        SELECT * FROM tweet WHERE tweet.user_id = ${user_id} AND tweet.tweet_id = ${tweetId};`;
    const tweetUser = await db.all(selectUseQuery);
    if (tweetUser.length !== 0) {
      const deleteTweetQuery = `
            DELETE FROM tweet
            WHERE
                tweet.user_id = ${user_id} AND tweet.tweet_id = ${tweetId};`;
      await db.run(deleteTweetQuery);
      response.send("Tweet Removed");
    } else {
      response.status(401);
      response.send("Invalid Request");
    }
  }
);
module.exports = app;
