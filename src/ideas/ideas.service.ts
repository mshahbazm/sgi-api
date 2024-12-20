import { HttpException, HttpStatus, Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { InjectModel } from '@nestjs/mongoose'
import { Model, Types } from 'mongoose'

import { MongoService } from 'src/common/services/mongo/mongo.service'
import { TagsService } from 'src/tags/tags.service'

import { Idea, IdeaDocument } from './entities/idea.entity'

export interface iBlob {
	fieldname: string
	originalname: string
	encoding: string
	mimetype: string
	buffer: Buffer
	size: number
}

@Injectable()
export class IdeasService {
	private defaultDataPopulation = [
		{
			path: 'tags',
			Model: 'Tag',
			select: '-_id title',
		},
	]

	private defaultDataPopulationDetail = [
		{
			path: 'tags',
			Model: 'Tag',
			select: '-_id title',
		},
		{
			path: 'creator',
			Model: 'User',
			select: '_id first_name',
		},
	]

	private deSelectAttributes =
		'-colors -ogImage -filesIncluded -isPremium -screenshotsWebP'
	private categories = ['illustration', 'icon']

	constructor(
		@InjectModel(Idea.name) private ideaModel: Model<IdeaDocument>,
		private queryHelpers: MongoService,
		private config: ConfigService,
		private tagsService: TagsService
	) {}

	private async create(body: Idea) {
		if (body.title) body.title = body.title.toLowerCase()
		const idea = new this.ideaModel({ ...body })
		return idea.save()
	}

	async newIdea(body: Idea, picture: any) {
		if (body.tags) {
			const lowerTags = body.tags.toString().toLowerCase()
			body.tags = await this.tagsService.getTagsIds(lowerTags)
		} else {
			throw new HttpException('Tags are required', HttpStatus.BAD_REQUEST)
		}

		if (picture && picture.length > 0) {
			body.picture = picture
		}
		return this.create(body)
	}

	async update(
		id: Types.ObjectId,
		updates: Idea,
		picture: any,
		userId: Types.ObjectId
	) {
		const idea = await this.ideaModel.findById(id)

		if (idea.creator.toString() !== userId.toString())
			throw new HttpException('unauthorized', HttpStatus.UNAUTHORIZED)
		if (updates.tags) {
			const lowerTags = updates.tags.toString().toLowerCase()
			updates.tags = await this.tagsService.getTagsIds(lowerTags)
		} else {
			throw new HttpException('Tags are required', HttpStatus.BAD_REQUEST)
		}

		console.log('here', picture)
		if (picture && picture.length > 0) {
			updates.picture = picture
		}

		return this.ideaModel
			.findOneAndUpdate({ _id: id }, { ...updates }, { new: true })
			.orFail()
	}

	async findAll(queryObject: Record<string, unknown>) {
		for (const [k, v] of Object.entries(queryObject)) {
			if (Array.isArray(v)) {
				queryObject[k] = v[(v as []).length - 1]
			}
		}

		let resultedTags = null
		if (queryObject.tags || queryObject.search) {
			let tagIds = [],
				tagTitles = [],
				tags = []

			if (queryObject.tags) {
				queryObject.tags = (queryObject.tags as string)
					.split('-')
					.join(' ')
			}
			// console.log(queryObject);

			if (queryObject.tags && queryObject.search)
				tags = await this.tagsService.getAllMatchingTags(
					(queryObject.tags as string).split(','),
					queryObject.search as string
				)
			else if (queryObject.search)
				tags = await this.tagsService.getAllMatchingTags(
					null,
					queryObject.search as string
				)
			else if (queryObject.tags && (queryObject.tags as string).length)
				tags = await this.tagsService.getTagsByTitle(
					queryObject.tags as string
				)

			if (tags && tags.length) {
				for (const tag of tags) {
					tagIds.push(tag._id)
					tagTitles.push(tag.title)
				}
				queryObject.tagIds = tagIds
				resultedTags = tags
			}
		}

		const { query, skip, pageSize } = this.queryHelpers.build(queryObject)
		delete queryObject.tagIds

		let results = {},
			currentTotal = 0
		if (queryObject.tags && !resultedTags && !queryObject.search) {
			results = {}
		} else {
			results = await this.ideaModel
				.find(query)
				.sort({ createdAt: -1 })
				.populate(this.defaultDataPopulation)
				.select(this.deSelectAttributes)
				.skip(skip)
				.limit(pageSize)
				.exec()
			currentTotal = await this.ideaModel.find(query).countDocuments()
		}

		queryObject.page_size = pageSize
		queryObject.pages = Math.ceil(currentTotal / pageSize)

		return {
			count: +currentTotal,
			query: queryObject,
			tags: resultedTags,
			ideas: results,
		}
	}

	async findById(id: Types.ObjectId) {
		return this.ideaModel
			.findById(id)
			.populate(this.defaultDataPopulationDetail)
			.exec()
	}

	async clicked(id: Types.ObjectId): Promise<any> {
		const idea = await this.ideaModel.findById(id)
		if (idea) {
			idea['clickCount'] = idea['clickCount'] + 1
			idea.save()
			return idea
		}
		throw new HttpException('Not found', HttpStatus.NOT_FOUND)
	}

	async findOne(queryObject: Record<string, unknown>): Promise<IdeaDocument> {
		return this.ideaModel
			.findOne({ ...queryObject })
			.populate(this.defaultDataPopulationDetail)
			.select(this.deSelectAttributes)
	}

	async delete(id: Types.ObjectId) {
		return this.ideaModel.findOneAndDelete({ _id: id }).orFail()
	}

	async deactivate(id: Types.ObjectId) {
		return this.ideaModel
			.findOneAndUpdate(
				{ _id: id },
				{ isPublished: false },
				{ new: true }
			)
			.orFail()
	}

	async activate(id: Types.ObjectId) {
		return this.ideaModel
			.findOneAndUpdate({ _id: id }, { isPublished: true }, { new: true })
			.orFail()
	}
}
