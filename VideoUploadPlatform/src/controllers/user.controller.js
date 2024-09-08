import { asyncHandler } from "../utils/asyncHandler.js";
import { APIError } from "../utils/APIError.js";
import { User } from "../models/user.model.js";
import { uploadOnCloudinary } from "../utils/cloudinary.js";
import { APIResponse } from "../utils/APIResponse.js";
import jwt from "jsonwebtoken";
import mongoose, { mongo } from "mongoose";

// const options = {
//     httpOnly: true,
//     secure: true
// }


const registerUser = asyncHandler(async (req, res) => {
    // res.status(200).json({
    //     message: "You think you know me!"
    // })
    // 1. Accept data from request & check if the request is valid
    // 2. If valid send it to db to create doc for this user
    // 3. After confirmation of the creation, return success

    // Get user details from frontend
    const { username, email, fullname, password } = req.body;

    // console.log(username);
    // console.log(email);
    // console.log(fullname);

    // validation - not empty
    if ([username, email, fullname, password].some((field) => field?.trim() === ""))
        throw new APIError(400, "All fields are required");

    // check if user already exists: username, email
    const existingUser = await User.findOne({ $or: [{ username }, { email }] });

    if (existingUser)
        throw new APIError(409, "User exists");

    // check for images, check for avatar
    // console.log("Request Files: ", (req.files)?(req.files)"File Error");
    console.log("Request Files: ",
        req.files
            ? Object.values(req.files).flat().forEach(file => console.log(file.fieldname))
            : "File Error"
    );

    const avatarLocalPath = req.files?.avatar[0]?.path;
    // const coverLocalPath = req.files?.coverImage[0]?.path;

    let coverLocalPath;
    if (req.files && Array.isArray(req.files.coverImage) && (req.files.coverImage.length > 0))
        coverLocalPath = req.files.coverImage[0].path;

    if (!avatarLocalPath)
        throw new APIError(411, "Avatar is required");

    // upload them to cloudinary, avatar
    const avatar = await uploadOnCloudinary(avatarLocalPath);
    const coverImage = await uploadOnCloudinary(coverLocalPath);

    if (!avatar)
        throw new APIError(411, "Avatar is required");

    // create user object - create entry in db
    const user = await User.create({
        fullname,
        avatar: avatar.url,
        coverImage: (coverImage)?.url || "",
        username: username.toLowerCase(),
        password,
        email
    })

    // remove password and refresh token field from response
    const createdUser = await User.findById(user._id).select("-password -refreshToken");


    // check for user creation
    if (!createdUser)
        throw new APIError(450, "User creation error");

    // return response or error
    console.log(200, createdUser, "Registered Successfully");
    return res.status(201).json(
        new APIResponse(200, createdUser, "Registered Successfully")
    )


    // res.status(200).json({
    //     message: "Got the details: Thanks!"
    // })

    // res.send();


})

const loginUser = asyncHandler(async (req, res) => {
    // 1. Get user details
    // 2. Check if they are not empty
    // 3. Lerify if the user with the same crudential exists
    // 4. Login the user

    const generateAccessAndRefreshToken = async (userId) => {
        try {
            const user = await User.findById(userId);
            if (!user)
                throw new APIError(503, "User Not Found");

            const accessToken = user.generateAccessToken();
            const refreshToken = user.generateRefreshToken();
            user.refreshToken = refreshToken;
            await user.save({ validateBeforeSave: false });

            return { accessToken, refreshToken };
        } catch (error) {
            throw new APIError(500, "Unable to generate tokens");
        }
    }

    // req body -> data
    const { email, username, password } = req.body;

    // if (username) console.log(username);
    // else console.log("No username");
    // if (email) console.log(email);
    // else console.log("No email");

    // username or email
    if (!(username || email))
        throw new APIError(400, "Email or Username is required");



    // find the user
    const user = await User.findOne({ $or: [{ username }, { email }] });
    if (!user)
        throw new APIError(400, "Username doesn't exist");

    // password check
    const passwordValid = await user.isPasswordCorrect(password);
    if (!passwordValid)
        throw new APIError(400, "Incorrect password");

    // generate access and refresh token
    const { accessToken, refreshToken } = await generateAccessAndRefreshToken(user._id);

    const loggedInUser = await User.findById(user._id).select("-password -refreshToken");

    // user.refreshToken = undefined; // Alternative steps for above
    // user.password = undefined; // Alternative steps for above

    // send cookies
    const options = {
        httpOnly: true,
        secure: true
    }

    return res
        .status(200)
        .cookie("accessToken", accessToken, options)
        .cookie("refreshToken", refreshToken, options)
        .json(
            new APIResponse(
                200,
                {
                    user: loggedInUser,
                    accessToken,
                    refreshToken
                },
                "Login Successful"
            )
        )
})

// Secured Routes
const logoutUser = asyncHandler(async (req, res) => {
    // 1. Delete refreshToken from Database
    // await User.findByIdAndUpdate(req.user._id, { $set: { refreshToken: undefined } }, { new: true });
    await User.findByIdAndUpdate(
        req.user._id,
        {
            $unset: {
                refreshToken: 1
            }
        },
        {
            new: true
        }
    );
    // 2. Delete accessToken, refreshToken from Local
    const options = {
        httpOnly: true,
        secure: true
    }

    return res
        .status(200)
        .clearCookie("accessToken", options)
        .clearCookie("refreshToken", options)
        .json(
            new APIResponse(
                200,
                {},
                "User Logged Out Successfully"
            )
        )
})

const refreshAccessToken = asyncHandler(async (req, res) => {
    // 1. accept refreshToken
    const incomingRefreshToken = req.cookies.refreshToken || req.body.refreshToken;

    if (!incomingRefreshToken)
        throw new APIError(401, "Unauthorized Request: Invalid Refresh Token");

    try {
        const decodedToken = jwt.verify(incomingRefreshToken, process.env.REFRESH_TOKEN_SECRET);

        const user = await User.findById(decodedToken?._id);

        if (!user)
            throw new APIError(401, "User Not Found: Invalid Refresh Token");

        // 2. compare refreshToken
        if (incomingRefreshToken !== user?.refreshToken)
            throw new APIError(401, "Expired Refresh Token");

        // 3. generate AccessToken
        const options = {
            httpOnly: true,
            secure: true
        }

        const { accessToken, newRefreshToken } = await generateAccessAndRefreshToken(user._id);

        // 4. send AccessToken
        return res
            .status(200)
            .cookie("accessToken", accessToken, options)
            .cookie("refreshToken", newRefreshToken, options)
            .json(
                new APIResponse(
                    200,
                    {
                        accessToken,
                        refreshToken: newRefreshToken
                    },
                    "Access Token Refreshed"
                )
            )
    } catch (error) {
        throw new APIError(400, error?.message || "Invalid Refresh Token");
    }
})

const changeCurrentUserPassword = asyncHandler(async (req, res) => {
    try {
        const { oldPassword, newPassword, confirmPassword } = req.body;
        if (newPassword !== confirmPassword)
            throw new APIError(400, "Password doesn't match");
        const user = await User.findById(req.user?._id);
        const isPasswordCorrect = await user.isPasswordCorrect(oldPassword);
        if (!isPasswordCorrect)
            throw new APIError(400, "Invalid Old Password");
        user.password = newPassword;
        await user.save({ validateBeforeSave: false });

        return res
            .status(200)
            .json(
                new APIResponse(
                    200,
                    {},
                    "Password Changed Successfully"
                )
            )
    } catch (error) {
        throw new APIError(400, "Unable to change password");
    }
})

const getCurrentUser = asyncHandler(async (req, res) => {
    return res
        .status(200)
        .json(
            new APIResponse(
                200,
                req.user,
                "Current user fetched successfully"
            )
        )
})

const updateAccountDetails = asyncHandler(async (req, res) => {
    const { username, fullname, email } = req.body;
    if (!(username || fullname || email))
        throw new APIError(400, "Username is required");

    try {
        const user = await User.findByIdAndUpdate(
            req.user?._id,
            {
                $set: {
                    username, email, fullname
                }
            },
            {
                new: true
            }
        ).select("-password")

        return res
            .status(200)
            .json(
                new APIResponse(
                    200,
                    user,
                    "Account Details Updated Successfully"
                )
            )
    } catch (error) {
        throw new APIError(400, "Unable to update details");
    }

})

const updateUserAvatar = asyncHandler(async (req, res) => {
    const avatarLocalPath = req.file?.path;
    if (!avatarLocalPath)
        throw new APIError(400, "Avatar file missing");

    const avatar = await uploadOnCloudinary(avatarLocalPath);

    if (!avatar.url)
        throw new APIError(400, "Error while uploading avatar file");

    try {
        const user = await User.findByIdAndUpdate(
            req.user?._id,
            {
                $set: {
                    avatar: avatar.url
                }
            },
            {
                new: true
            }
        ).select("-password")

        return res
            .status(200)
            .json(
                new APIResponse(
                    200,
                    user,
                    "Avatar image updated"
                )
            )
    } catch (error) {
        throw new APIError(400, "Unable to update avatar");
    }
}) // Similar for Cover Image, Add functionality: delete image from cloudinary 

const getUserChannelProfile = asyncHandler(async (req, res) => {
    const { username } = req.params;
    if (!username?.trim()) {
        throw new APIError(400, "Missing Username");
    }

    const channel = await User.aggregate([
        {
            $match: {
                username: username?.toLowerCase()
            }
        },
        {
            $lookup: {
                from: "subscriptions",
                localField: "_id",
                foreignField: "channel",
                as: "subscriberList"
            }
        },
        {
            $lookup: {
                from: "subscriptions",
                localField: "_id",
                foreignField: "subscriber",
                as: "channelsSubscribed"
            }
        },
        {
            $addFields: {
                subscriberCount: {
                    $size: "$subscriberList"
                },
                subscriptionCount: {
                    $size: "$channelsSubscribed"
                },
                isSubscribed: {
                    $cond: {
                        if: { $in: [req.user?._id, "$subscriberList.subscriber"] },
                        then: true,
                        else: false
                    }
                }
            }
        },
        {
            $project: {
                username: 1,
                email: 1,
                fullname: 1,
                subscriberCount: 1,
                subscriptionCount: 1,
                isSubscribed: 1,
                avatar: 1,
                coverImage: 1
            }
        }
    ]) // Note that "in" can work on objects as well as on arrays

    if (!channel?.length)
        throw new APIError(400, "Channel doesn't exist");

    return res
        .status(200)
        .json(
            new APIResponse(
                200,
                channel[0],
                "User channel details fetched successfully"
            )
        )
}) // The aggregation pipeline mostly returns an array as a result

const getUserWatchHistory = asyncHandler(async (req, res) => {
    const user = await User.aggregate([
        {
            $match: {
                _id: new mongoose.Types.ObjectId(String(req.user._id))
            }
        },
        {
            $lookup: {
                from: "videos",
                localField: "watchHistory",
                foreignField: "_id",
                as: "watchHistoryArray",
                pipeline: [
                    {
                        $lookup: {
                            from: "users",
                            localField: "owner",
                            foreignField: "_id",
                            as: "owner", // add fields from here
                            pipeline: [
                                {
                                    $project: {
                                        username: 1,
                                        fullname: 1,
                                        avatar: 1
                                    }
                                }
                            ]
                        }
                    },
                    {
                        $addFields: {
                            owner: {
                                $first: "$owner"
                            }
                        }
                    }
                ]
            }
        }
    ])

    return res
        .status(200)
        .json(
            new APIResponse(
                200,
                user[0].watchHistory,
                "Watch history fetched successfully"
            )
        )
})

export {
    registerUser,
    loginUser,
    logoutUser,
    refreshAccessToken,
    changeCurrentUserPassword,
    getCurrentUser,
    updateAccountDetails,
    updateUserAvatar,
    getUserChannelProfile,
    getUserWatchHistory
};

/*
throw new APIError(400, "");
new APIResponse(
    200, 
    {},
    ""
)
*/